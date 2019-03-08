/*global define,KBError,KBFatal,window,console,document*/
/*jslint white:true,browser:true*/

/**
 * This is the entry point for the Narrative's front-end. It initializes
 * the login session, fires up the data and function widgets, and creates
 * the kbaseNarrativeWorkspace wrapper around the Jupyter notebook that
 * does fun things like manage widgets and cells and kernel events to talk to them.
 *
 * To set global variables, use: Jupyter.narrative.<name> = value
 */

define([
    'jquery',
    'bluebird',
    'handlebars',
    'narrativeConfig',
    'kbaseNarrativeSidePanel',
    'kbaseNarrativeOutputCell',
    'kbaseNarrativeWorkspace',
    'kbaseNarrativeMethodCell',
    'kbaseAccordion',
    'kbaseNarrativeSharePanel',
    'kbaseNarrativePrestart',
    'ipythonCellMenu',
    'base/js/namespace',
    'base/js/events',
    'base/js/keyboard',
    'notebook/js/notebook',
    'util/display',
    'util/bootstrapDialog',
    'util/timeFormat',
    'text!kbase/templates/update_dialog_body.html',
    'text!kbase/templates/document_version_change.html',
    'narrativeLogin',
    'common/ui',
    'common/html',
    'common/runtime',
    'narrativeTour',
    'kb_service/utils',
    'widgets/loadingWidget',
    'kb_service/client/workspace',
    // for effect
    'bootstrap',

], function (
    $,
    Promise,
    Handlebars,
    Config,
    KBaseNarrativeSidePanel,
    KBaseNarrativeOutputCell,
    KBaseNarrativeWorkspace,
    KBaseNarrativeMethodCell,
    KBaseAccordion,
    KBaseNarrativeSharePanel,
    KBaseNarrativePrestart,
    KBaseCellToolbar,
    Jupyter,
    Events,
    Keyboard,
    Notebook,
    DisplayUtil,
    BootstrapDialog,
    TimeFormat,
    UpdateDialogBodyTemplate,
    DocumentVersionDialogBodyTemplate,
    NarrativeLogin,
    UI,
    html,
    Runtime,
    Tour,
    ServiceUtils,
    LoadingWidget,
    Workspace
) {
    'use strict';

    KBaseNarrativePrestart.loadDomEvents();
    KBaseNarrativePrestart.loadGlobals();
    KBaseNarrativePrestart.loadJupyterEvents();

    /**
     * @constructor
     * The base, namespaced Narrative object. This is mainly used at start-up time, and
     * gets injected into the Jupyter namespace.
     *
     * Most of its methods below - init, registerEvents, initAboutDialog, initUpgradeDialog,
     * checkVersion, updateVersion - are set up at startup time.
     * This is all done by an injection into static/notebook/js/main.js where the
     * Narrative object is set up, and Narrative.init is run.
     *
     * But, this also has a noteable 'Save' method, that implements another Narrative-
     * specific piece of functionality. See Narrative.prototype.saveNarrative below.
     */
    var Narrative = function () {
        // Maximum narrative size that can be stored in the workspace.
        // This is set by nginx on the backend - this variable is just for
        // communication on error.
        this.maxNarrativeSize = '10 MB';

        // the controller is an instance of kbaseNarrativeWorkspace, which
        // controls widget management and KBase method execution
        this.narrController = null;

        this.sidePanel = null;

        // If true, this narrative is read only
        this.readonly = false;

        // The user's current session token.
        this.authToken = null;

        // How often to check for a new version in ms (not currently used)
        this.versionCheckTime = 6000 * 60 * 1000;

        this.versionHtml = 'KBase Narrative';

        // The currently selected Jupyter cell.
        this.selectedCell = null;

        // The version of the Narrative UI (semantic version)
        this.currentVersion = Config.get('version');

        // The version of the currently loaded Narrative document object.
        this.documentVersionInfo = [];
        this.stopVersionCheck = false;

        //
        this.dataViewers = null;

        // Used for mapping from user id -> user name without having to it
        // up again every time.
        this.cachedUserIds = {};

        this.runtime = Runtime.make();
        this.workspaceRef = null;
        this.workspaceId = this.runtime.workspaceId();
        this.workspaceInfo = {};
        this.sidePanel = null;

        // The set of currently instantiated KBase Widgets.
        // key = cell id, value = Widget object itself.
        this.kbaseWidgets = {};

        this.loadingWidget = new LoadingWidget({
            node: document.querySelector('#kb-loading-blocker'),
            timeout: 20000
        });

        //Jupyter.keyboard_manager.disable();
        return this;
    };

    Narrative.prototype.isLoaded = function () {
        return Jupyter.notebook._fully_loaded;
    };

    Narrative.prototype.uiModeIs = function (testMode) {
        var uiMode = Jupyter.notebook.writable ? 'edit' : 'view';
        return testMode.toLowerCase() === uiMode;
    };

    Narrative.prototype.getAuthToken = function () {
        return NarrativeLogin.getAuthToken();
    };

    Narrative.prototype.getNarrativeRef = function () {
        return Promise.try(() => {
            if (this.workspaceRef) {
                return this.workspaceRef;
            }
            else {
                return new Workspace(Config.url('workspace'), {token: this.getAuthToken()})
                    .get_workspace_info({id: this.workspaceId})
                    .then((wsInfo) => {
                        let narrId = wsInfo[8]['narrative'];
                        this.workspaceRef = this.workspaceId + '/' + narrId;
                        return this.workspaceRef;
                    });
            }
        });
    };

    Narrative.prototype.getUserPermissions = function () {
        return new Workspace(Config.url('workspace'), {token: this.getAuthToken()})
            .get_workspace_info({id: this.workspaceId})
            .then((wsInfo) => {
                return wsInfo[5];
            });
    }

    /**
     * A wrapper around the Jupyter.notebook.kernel.execute() function.
     * If any KBase widget needs to make a kernel call, it should go through here.
     * ...when it's done.
     */
    Narrative.prototype.executeKernelCall = function () {
        console.info('no-op for now');
    };

    // Wrappers for the Jupyter/Jupyter function so we only maintain it in one place.
    Narrative.prototype.patchKeyboardMapping = function () {
        var commonShortcuts = [
                'a', 'm', 'f', 'y', 'r',
                '1', '2', '3', '4', '5', '6',
                'k', 'j', 'b', 'x', 'c', 'v',
                'z', 'd,d', 's', 'l', 'o', 'h',
                'i,i', '0,0', 'q', 'shift-j', 'shift-k',
                'shift-m', 'shift-o', 'shift-v'
            ],
            commandShortcuts = [],
            editShortcuts = [
                // remove the command palette
                // since it exposes commands we have "disabled"
                // by removing keyboard mappings
                'cmdtrl-shift-p',
            ];

        commonShortcuts.forEach(function (shortcut) {
            try {
                Jupyter.keyboard_manager.command_shortcuts.remove_shortcut(shortcut);
            } catch (ex) {
                console.warn('Error removing shortcut "' + shortcut + '"', ex);
            }
            try {
                Jupyter.notebook.keyboard_manager.edit_shortcuts.remove_shortcut(shortcut);
            } catch (ex) {
                // console.warn('Error removing shortcut "'  + shortcut +'"', ex);
            }
        });

        commandShortcuts.forEach(function (shortcut) {
            try {
                Jupyter.keyboard_manager.command_shortcuts.remove_shortcut(shortcut);
            } catch (ex) {
                console.warn('Error removing shortcut "' + shortcut + '"', ex);
            }
        });

        editShortcuts.forEach(function (shortcut) {
            try {
                Jupyter.notebook.keyboard_manager.edit_shortcuts.remove_shortcut(shortcut);
            } catch (ex) {
                console.warn('Error removing shortcut "' + shortcut + '"', ex);
            }
        });
    };

    Narrative.prototype.disableKeyboardManager = function () {
        Jupyter.keyboard_manager.disable();
    };

    Narrative.prototype.enableKeyboardManager = function () {
        // Jupyter.keyboard_manager.enable();
    };

    /**
     * Registers Narrative responses to a few Jupyter events - mainly some
     * visual effects for managing when the cell toolbar should be shown,
     * and when saving is being done, but it also disables the keyboard
     * manager when KBase cells are selected.
     */
    Narrative.prototype.registerEvents = function () {
        var self = this;
        $([Jupyter.events]).on('before_save.Notebook', function () {
            $('#kb-save-btn').find('div.fa-save').addClass('fa-spin');
        });
        $([Jupyter.events]).on('notebook_saved.Notebook', function () {
            $('#kb-save-btn').find('div.fa-save').removeClass('fa-spin');
            self.stopVersionCheck = false;
            self.updateDocumentVersion();
        });
        $([Jupyter.events]).on('kernel_idle.Kernel', function () {
            $('#kb-kernel-icon').removeClass().addClass('fa fa-circle-o');
        });
        $([Jupyter.events]).on('kernel_busy.Kernel', function () {
            $('#kb-kernel-icon').removeClass().addClass('fa fa-circle');
        });
        [
            'kernel_connected.Kernel', 'kernel_starting.Kernel', 'kernel_ready.Kernel',
            'kernel_disconnected.Kernel', 'kernel_killed.Kernel', 'kernel_dead.Kernel'
        ].forEach(function(e) {
            $([Jupyter.events]).on(e, function () {
                self.runtime.bus().emit(
                    'kernel-state-changed',
                    {
                        isReady: Jupyter.notebook.kernel && Jupyter.notebook.kernel.is_connected()
                    }
                );
                console.log('emitted kernel-state-changed event, probably not ready!');
            });
        });
        $([Jupyter.events]).on('delete.Cell', function () {
            // this.enableKeyboardManager();
        }.bind(this));

        $([Jupyter.events]).on('notebook_save_failed.Notebook', function (event, data) {
            $('#kb-save-btn').find('div.fa-save').removeClass('fa-spin');
            this.saveFailed(event, data);
        }.bind(this));
    };


    /**
     * Initializes the sharing panel and sets up the events
     * that show and hide it.
     *
     * This is a hack and a half because Select2, Bootstrap,
     * and Safari are all hateful things. Here are the sequence of
     * events.
     * 1. Initialize the dialog object.
     * 2. When it gets invoked, show the dialog.
     * 3. On the FIRST time it gets shown, after it's done
     * being rendered (shown.bs.modal event), then build and
     * show the share panel widget. The select2 thing only wants
     * to appear and behave correctly after the page loads, and
     * after there's a visible DOM element for it to render in.
     */
    Narrative.prototype.initSharePanel = function () {
        var sharePanel = $('<div style="text-align:center"><br><br><img src="' +
                Config.get('loading_gif') +
                '"></div>'),
            shareWidget = null,
            shareDialog = new BootstrapDialog({
                title: 'Change Share Settings',
                body: sharePanel,
                closeButton: true
            });
        shareDialog.getElement().one('shown.bs.modal', function () {
            shareWidget = new KBaseNarrativeSharePanel(sharePanel.empty(), {
                ws_name_or_id: this.getWorkspaceName()
            });
        }.bind(this));
        $('#kb-share-btn').click(function () {
            var narrName = Jupyter.notebook.notebook_name;
            if (narrName.trim().toLowerCase() === 'untitled' || narrName.trim().length === 0) {
                Jupyter.save_widget.rename_notebook({
                    notebook: Jupyter.notebook,
                    message: 'Please name your Narrative before sharing.',
                    callback: function () { shareDialog.show(); }
                });
                return;
            }
            if (shareWidget) {
                shareWidget.refresh();
            }
            shareDialog.show();
        }.bind(this));
    };

    /**
     * Expects docInfo to be a workspace object info array, especially where the 4th element is
     * an int > 0.
     */
    Narrative.prototype.checkDocumentVersion = function (docInfo) {
        if (docInfo.length < 5 || this.stopVersionCheck) {
            return;
        }
        if (docInfo[4] !== this.documentVersionInfo[4]) {
            // now we make the dialog and all that.
            $('#kb-narr-version-btn')
                .off('click')
                .on('click', function() {
                    this.showDocumentVersionDialog(docInfo);
                }.bind(this));
            this.toggleDocumentVersionBtn(true);
        }
    };

    /**
     * Expects the usual workspace object info array. If that's present, it's captured. If not,
     * we run get_object_info_new and fetch it ourselves. Note that it should have its metadata.
     */
    Narrative.prototype.updateDocumentVersion = function (docInfo) {
        var self = this;
        return Promise.try(function () {
            if (docInfo) {
                self.documentVersionInfo = docInfo;
            }
            else {
                var workspace = new Workspace(Config.url('workspace'), {token: self.getAuthToken()});
                self.getNarrativeRef()
                .then((narrativeRef) => {
                    return workspace.get_object_info_new({
                        objects: [{'ref': narrativeRef}],
                        includeMetadata: 1
                    });
                }).then(function (info) {
                    self.documentVersionInfo = info[0];
                }).catch(function (error) {
                    // no op for now.
                    console.error(error);
                });
            }
        });
    };

    Narrative.prototype.showDocumentVersionDialog = function (newVerInfo) {
        var bodyTemplate = Handlebars.compile(DocumentVersionDialogBodyTemplate);

        var versionDialog = new BootstrapDialog({
            title: 'Showing an older Narrative document',
            body: bodyTemplate({
                currentVer: this.documentVersionInfo,
                currentDate: TimeFormat.readableTimestamp(this.documentVersionInfo[3]),
                newVer: newVerInfo,
                newDate: TimeFormat.readableTimestamp(newVerInfo[3]),
                sameUser: this.documentVersionInfo[5] === newVerInfo[5],
                readOnly: this.readonly
            }),
            alertOnly: true
        });

        versionDialog.show();
    };

    /**
     * @method
     * @public
     * This shows or hides the "narrative has been saved in a different window" button.
     * If show is truthy, show it. Otherwise, hide it.
     */
    Narrative.prototype.toggleDocumentVersionBtn = function (show) {
        var $btn = $('#kb-narr-version-btn');
        if (show && !$btn.is(':visible')) {
            $btn.fadeIn('fast');
        }
        else if (!show && $btn.is(':visible')){
            $btn.fadeOut('fast');
        }
    };

    /**
     * The "Upgrade your container" dialog should be made available when
     * there's a more recent version of the Narrative ready to use. This
     * dialog then lets the user shut down their existing Narrative container.
     */
    Narrative.prototype.initUpgradeDialog = function () {
        var bodyTemplate = Handlebars.compile(UpdateDialogBodyTemplate);

        var $cancelBtn = $('<button type="button" data-dismiss="modal">')
            .addClass('btn btn-default')
            .append('Cancel');
        var $upgradeBtn = $('<button type="button" data-dismiss="modal">')
            .addClass('btn btn-success')
            .append('Update and Reload')
            .click(function () {
                this.updateVersion();
            }.bind(this));

        var upgradeDialog = new BootstrapDialog({
            title: 'New Narrative version available!',
            buttons: [$cancelBtn, $upgradeBtn]
        });
        $('#kb-update-btn').click(function () {
            upgradeDialog.show();
        });
        this.checkVersion()
            .then(function (ver) {
                upgradeDialog.setBody(bodyTemplate({
                    currentVersion: this.currentVersion,
                    newVersion: ver ? ver.version : "No new version",
                    releaseNotesUrl: Config.get('release_notes')
                }));
                if (ver && ver.version && this.currentVersion !== ver.version) {
                    $('#kb-update-btn').fadeIn('fast');
                }
            }.bind(this));
    };

    /**
     * Looks up what is the current version of the Narrative.
     * This should eventually get rolled into a Narrative Service method call.
     */
    Narrative.prototype.checkVersion = function () {
        // look up new version here.
        return Promise.resolve($.ajax({
            url: Config.url('version_check'),
            async: true,
            dataType: 'text',
            crossDomain: true,
            cache: false
        })).then(function (ver) {
            return Promise.try(function () {
                ver = $.parseJSON(ver);
                return ver;
            });
        }).catch(function (error) {
            console.error('Error while checking for a version update: ' + error.statusText);
            KBError('Narrative.checkVersion', 'Unable to check for a version update!');
        });
    };

    Narrative.prototype.createShutdownDialogButtons = function () {
        var $shutdownButton = $('<button>')
            .attr({ type: 'button', 'data-dismiss': 'modal' })
            .addClass('btn btn-danger')
            .append('Okay. Shut it all down!')
            .click(function () {
                this.updateVersion();
            }.bind(this));

        var $reallyShutdownPanel = $('<div style="margin-top:10px">')
            .append('This will shutdown your Narrative session and close this window.<br><b>Any unsaved data in any open Narrative in any window WILL BE LOST!</b><br>')
            .append($shutdownButton)
            .hide();

        var $firstShutdownBtn = $('<button>')
            .attr({ type: 'button' })
            .addClass('btn btn-danger')
            .append('Shutdown')
            .click(function () {
                $reallyShutdownPanel.slideDown('fast');
            });

        var $cancelButton = $('<button type="button" data-dismiss="modal">')
            .addClass('btn btn-default')
            .append('Dismiss')
            .click(function () {
                $reallyShutdownPanel.hide();
            });

        return {
            cancelButton: $cancelButton,
            firstShutdownButton: $firstShutdownBtn,
            finalShutdownButton: $shutdownButton,
            shutdownPanel: $reallyShutdownPanel
        };
    };

    Narrative.prototype.initAboutDialog = function () {
        var $versionDiv = $('<div>')
            .append('<b>Version:</b> ' + Config.get('version'));
        $versionDiv.append('<br><b>Git Commit:</b> ' + Config.get('git_commit_hash') + ' -- ' + Config.get('git_commit_time'));
        $versionDiv.append('<br>View release notes on <a href="' + Config.get('release_notes') + '" target="_blank">Github</a>');

        var urlList = Object.keys(Config.get('urls')).sort();
        var $versionTable = $('<table>')
            .addClass('table table-striped table-bordered');
        $.each(urlList,
            function (idx, val) {
                var url = Config.url(val);
                // if url looks like a url (starts with http), include it.
                // ignore job proxy and submit ticket
                if (val === 'narrative_job_proxy' ||
                    val === 'submit_jira_ticket' ||
                    val === 'narrative_method_store_types' ||
                    url === null) {
                    return;
                }
                url = url.toString();
                if (url && url.toLowerCase().indexOf('http') === 0) {
                    $versionTable.append($('<tr>')
                        .append($('<td>').append(val))
                        .append($('<td>').append(url)));
                }
            }
        );
        var $verAccordionDiv = $('<div style="margin-top:15px">');
        $versionDiv.append($verAccordionDiv);

        new KBaseAccordion($verAccordionDiv, {
            elements: [{
                title: 'KBase Service URLs',
                body: $versionTable
            }]
        });

        var shutdownButtons = this.createShutdownDialogButtons();
        var aboutDialog = new BootstrapDialog({
            title: 'KBase Narrative Properties',
            body: $versionDiv,
            buttons: [
                shutdownButtons.cancelButton,
                shutdownButtons.firstShutdownButton,
                shutdownButtons.shutdownPanel
            ]
        });

        $('#kb-about-btn').click(function () {
            aboutDialog.show();
        });
    };

    Narrative.prototype.initShutdownDialog = function () {
        var shutdownButtons = this.createShutdownDialogButtons();

        var shutdownDialog = new BootstrapDialog({
            title: 'Shutdown and restart narrative?',
            body: $('<div>').append('Shutdown and restart your Narrative session? Any unsaved changes in any open Narrative in any window WILL BE LOST!'),
            buttons: [
                shutdownButtons.cancelButton,
                shutdownButtons.finalShutdownButton
            ]
        });

        $('#kb-shutdown-btn').click(function () {
            shutdownDialog.show();
        });
    };

    Narrative.prototype.saveFailed = function (event, data) {
        $('#kb-save-btn').find('div.fa-save').removeClass('fa-spin');
        Jupyter.save_widget.set_save_status('Narrative save failed!');

        var errorText;
        // 413 means that the Narrative is too large to be saved.
        // currently - 4/6/2015 - there's a hard limit of 4MB per KBase Narrative.
        // Any larger object will throw a 413 error, and we need to show some text.
        if (data.xhr.status === 413) {
            errorText = 'Due to current system constraints, a Narrative may not exceed ' +
                this.maxNarrativeSize + ' of text.<br><br>' +
                'Errors of this sort are usually due to excessive size ' +
                'of outputs from Code Cells, or from large objects ' +
                'embedded in Markdown Cells.<br><br>' +
                'Please decrease the document size and try to save again.';
        } else if (data.xhr.responseText) {
            var $error = $($.parseHTML(data.xhr.responseText));
            errorText = $error.find('#error-message > h3').text();

            if (errorText) {
                /* gonna throw in a special case for workspace permissions issues for now.
                 * if it has this pattern:
                 *
                 * User \w+ may not write to workspace \d+
                 * change the text to something more sensible.
                 */

                var res = /User\s+(\w+)\s+may\s+not\s+write\s+to\s+workspace\s+(\d+)/.exec(errorText);
                if (res) {
                    errorText = 'User ' + res[1] + ' does not have permission to save to workspace ' + res[2] + '.';
                }
            }
        } else {
            errorText = 'An unknown error occurred!';
        }

        Jupyter.dialog.modal({
            title: 'Narrative save failed!',
            body: $('<div>').append(errorText),
            buttons: {
                OK: {
                    class: 'btn-primary',
                    click: function () {
                        return;
                    }
                }
            },
            open: function () {
                var that = $(this);
                // Upon ENTER, click the OK button.
                that.find('input[type="text"]').keydown(function (event) {
                    if (event.which === Keyboard.keycodes.enter) {
                        that.find('.btn-primary').first().click();
                    }
                });
                that.find('input[type="text"]').focus();
            }
        });
    };

    Narrative.prototype.initTour = function () {
        try {
            $('#kb-tour').click(function (e) {
                var tour = new Tour.Tour(this);
                tour.start();
            }.bind(this));
        } catch (e) {
            console.error(e);
        }
    };

    /**
     * This is the Narrative front end initializer. It should only be run directly after
     * the app_initialized.NotebookApp event has been fired.
     *
     * It does the following steps:
     * 1. Registers event listeners on Jupyter events such as cell selection, insertion,
     *    deletion, etc.
     * 2. Initializes the Core UI dialogs that depend on configuration information (About,
     *    Upgrade, and Shutdown)
     * 3. Initializes the
     */
    // This should not be run until AFTER the notebook has been loaded!
    // It depends on elements of the Notebook metadata.
    Narrative.prototype.init = function () {
        // NAR-271 - Firefox needs to be told where the top of the page is. :P
        window.scrollTo(0, 0);

        this.authToken = NarrativeLogin.getAuthToken();
        this.userId = NarrativeLogin.sessionInfo.user;

        Jupyter.narrative.patchKeyboardMapping();
        this.registerEvents();
        this.initAboutDialog();
        this.initUpgradeDialog();
        this.initShutdownDialog();
        this.initTour();

        /* Clever extension to $.event from StackOverflow
         * Lets us watch DOM nodes and catch when a widget's node gets nuked.
         * http://stackoverflow.com/questions/2200494/jquery-trigger-event-when-an-element-is-removed-from-the-dom
         *
         * We bind a jQuery event to a node. Call it 'destroyed'.
         * When that event is no longer bound (i.e. when the node is removed, OR when .unbind is called)
         * it triggers the 'remove' function. Lets us keep track of when widgets get removed
         * in the registerWidget function below.
         */
        $.event.special.destroyed = {
            remove: function (o) {
                if (o.handler) {
                    o.handler();
                }
            }
        };

        $([Jupyter.events]).on('notebook_loaded.Notebook', function () {
            this.loadingWidget.updateProgress('narrative', true);
            $('#notification_area').find('div#notification_trusted').hide();

            $(document).one('dataUpdated.Narrative', function () {
                this.loadingWidget.updateProgress('data', true);
            }.bind(this));

            $(document).one('appListUpdated.Narrative', function () {
                this.loadingWidget.updateProgress('apps', true);
            }.bind(this));

            // Tricky with inter/intra-dependencies between kbaseNarrative and kbaseNarrativeWorkspace...
            this.sidePanel = new KBaseNarrativeSidePanel($('#kb-side-panel'), { autorender: false });
            this.narrController = new KBaseNarrativeWorkspace($('#notebook_panel'), {
                ws_id: this.getWorkspaceName()
            });

            // Disable autosave so as not to spam the Workspace.
            Jupyter.notebook.set_autosave_interval(0);
            KBaseCellToolbar.register(Jupyter.notebook);
            Jupyter.CellToolbar.activate_preset('KBase');
            Jupyter.CellToolbar.global_show();

            if (Jupyter.notebook && Jupyter.notebook.metadata) {
                var creatorId = Jupyter.notebook.metadata.creator || 'KBase User';
                DisplayUtil.displayRealName(creatorId, $('#kb-narr-creator'));

                // This puts the cell menu in the right place.
                $([Jupyter.events]).trigger('select.Cell', { cell: Jupyter.notebook.get_selected_cell() });
            }
            if (this.getWorkspaceName() === null) {
                KBFatal('Narrative.init', 'Unable to locate workspace name from the Narrative object!');
                this.loadingWidget.remove();
                return;
            }
            this.initSharePanel();
            this.updateDocumentVersion()
                .then(function() {
                    // init the controller
                    return this.narrController.render();
                }.bind(this))
                .finally(function () {
                    this.sidePanel.render();
                }.bind(this));

            $([Jupyter.events]).trigger('loaded.Narrative');
            $([Jupyter.events]).on('kernel_ready.Kernel',
                function () {
                    console.log('Kernel Ready! Initializing Job Channel...');
                    this.loadingWidget.updateProgress('kernel', true);
                    // TODO: This should be an event "kernel-ready", perhaps broadcast
                    // on the default bus channel.
                    this.sidePanel.$jobsWidget.initCommChannel()
                        .then(function () {
                            this.loadingWidget.updateProgress('jobs', true);
                        }.bind(this))
                        .catch(function (err) {
                            // TODO: put the narrative into a terminal state
                            console.error('ERROR initializing kbase comm channel', err);
                            KBFatal('Narrative.ini', 'KBase communication channel could not be initiated with the back end. TODO');
                            // this.loadingWidget.remove();
                        }.bind(this));
                }.bind(this)
            );
        }.bind(this));
    };

    /**
     * @method
     * @public
     * This manually deletes the Docker container that this Narrative runs in, if there is one.
     * If it can't, or if this is being run locally, it pops up an alert saying so.
     */
    Narrative.prototype.updateVersion = function () {
        var user = NarrativeLogin.sessionInfo.user; //.loginWidget($('#signin-button')).session('user_id');
        Promise.resolve(
            $.ajax({
                contentType: 'application/json',
                url: '/narrative_shutdown/' + user,
                type: 'DELETE',
                crossDomain: true
            }))
            .then(function () {
                setTimeout(function () {
                    location.reload(true);
                }, 200);
            })
            .catch(function (error) {
                window.alert('Unable to update your Narrative session\nError: ' + error.status + ': ' + error.statusText);
                console.error(error);
            });
    };

    /**
     * @method
     * @public
     * This triggers a save, but saves all cell states first.
     */
    Narrative.prototype.saveNarrative = function () {
        this.stopVersionCheck = true;
        this.narrController.saveAllCellStates();
        Jupyter.notebook.save_checkpoint();
        this.toggleDocumentVersionBtn(false);
    };

    /**
     * @method
     * @public
     * Insert a new App cell into a narrative and pre-populate its parameters with a given set of
     * values. The cell is inserted below the currently selected cell.
     * @param {string} appId - The id of the app (should be in form module_name/app_name)
     * @param {string} tag - The release tag of the app (one of release, beta, dev)
     * @param {object} parameters - Key-value-pairs describing the parameters to initialize the app
     * with. Keys are param ids (should match the spec), and values are the values of those
     * parameters.
     */
    Narrative.prototype.addAndPopulateApp = function(appId, tag, parameters) {
        this.sidePanel.$methodsWidget.triggerApp(appId, tag, parameters);
    };

    /**
     * @method
     * @public
     * Insert a new Viewer cell into a narrative for a given object. The new cell is inserted below
     * the currently selected cell.
     * @param {string|object|array} obj - If a string, expected to be an object reference. If an object,
     * expected to be a set of Key-value-pairs describing the object. If an array, expected to be
     * the usual workspace info array for an object.
     */
    Narrative.prototype.addViewerCell = function(obj) {
        if (Jupyter.narrative.readonly) {
            new BootstrapDialog({
                type: 'warning',
                title: 'Warning',
                body: 'Read-only Narrative -- may not add a data viewer to this Narrative',
                alertOnly: true
            }).show();
            return;
        }
        var cell = Jupyter.notebook.get_selected_cell(),
            nearIdx = 0;
        if (cell) {
            nearIdx = Jupyter.notebook.find_cell_index(cell);
        }
        var objInfo = {};
        // If a string, expect a ref, and fetch the info.
        if (typeof obj === 'string') {
            objInfo = this.sidePanel.$dataWidget.getDataObjectByRef(obj, true);
        }
        // If an array, expect it to be an array of the info, and convert it.
        else if (Array.isArray(obj)) {
            objInfo = ServiceUtils.objectInfoToObject(obj);
        }
        // If not an array or a string, it's our object already.
        else {
            objInfo = obj;
        }
        this.narrController.trigger('createViewerCell.Narrative', {
            'nearCellIdx': nearIdx,
            'widget': 'kbaseNarrativeDataCell',
            'info': objInfo
        });
    };

    /**
     * @method
     * @public
     * Insert a new method into the narrative, set it as active, populate the
     * parameters, and run it.  This is useful for widgets that need to trigger
     * some additional narrative action, such as creating a FeatureSet from
     * a selected set of Features in a widget, or computing a statistic on a
     * subselection made from within a widget.
     */
    Narrative.prototype.createAndRunMethod = function (method_id, parameters) {
        //first make a request to get the method spec of a particular method
        //getFunctionSpecs.Narrative is implemented in kbaseNarrativeAppPanel
        var request = { methods: [method_id] };
        var self = this;
        self.narrController.trigger('getFunctionSpecs.Narrative', [request,
            function (specs) {
                // do nothing if the method could not be found
                var errorMsg = 'Method ' + method_id + ' not found and cannot run.';
                if (!specs) {
                    console.error(errorMsg);
                    return;
                }
                if (!specs.methods) {
                    console.error(errorMsg);
                    return;
                }
                if (!specs.methods[method_id]) {
                    console.error(errorMsg);
                    return;
                }
                // put the method in the narrative by simulating a method clicked in kbaseNarrativeAppPanel
                self.narrController.trigger('methodClicked.Narrative', specs.methods[method_id]);

                // the method initializes an internal method input widget, but rendering and initializing is
                // async, so we have to wait and check back before we can load the parameter state.
                // TODO: update kbaseNarrativeMethodCell to return a promise to mark when rendering is complete
                var newCell = Jupyter.notebook.get_selected_cell();
                var newCellIdx = Jupyter.notebook.get_selected_index();
                var newWidget = new KBaseNarrativeMethodCell($('#' + $(newCell.get_text())[0].id));
                var updateStateAndRun = function () {
                    if (newWidget.$inputWidget) {
                        // if the $inputWidget is not null, we are good to go, so set the parameters
                        newWidget.loadState(parameters);
                        // make sure the new cell is still selected, then run the method
                        Jupyter.notebook.select(newCellIdx);
                        newWidget.runMethod();
                    } else {
                        // not ready yet, keep waiting
                        window.setTimeout(updateStateAndRun, 500);
                    }
                };
                // call the update and run after a short deplay
                window.setTimeout(updateStateAndRun, 50);
            }
        ]);
    };

    Narrative.prototype.getWorkspaceName = function () {
        return Jupyter.notebook.metadata.ws_name || null;
    };

    Narrative.prototype.lookupUserProfile = function (username) {
        return DisplayUtil.lookupUserProfile(username);
    };

    /**
     * A little bit of a riff on the Jupyter "find_cell_index".
     * Every KBase-ified cell (App, Method, Output) has a unique identifier.
     * This can be used to find the closest cell element - its index is the
     * Jupyter cell index (inferred somewhat from find_cell_index which calls
     * get_cell_elements, which does this searching).
     */
    Narrative.prototype.getCellIndexByKbaseId = function (id) {
        if (!Jupyter.notebook) {
            return null;
        }
        var cells = Jupyter.notebook.get_cells();
        for (var i = 0; i < cells.length; i++) {
            var c = cells[i];
            if (c.metadata.kbase &&
                c.metadata.kbase.attributes &&
                c.metadata.kbase.attributes.id &&
                c.metadata.kbase.attributes.id === id) {
                return i;
            }
        }
        return null;
    };

    Narrative.prototype.getCellByKbaseId = function (id) {
        var cellIndex = this.getCellIndexByKbaseId(id);
        if (cellIndex !== null) {
            return Jupyter.notebook.get_cell(this.getCellIndexByKbaseId(id));
        }
        return null;
    };

    /**
     * Jupyter doesn't auto select cells on creation, so this
     * is a helper that does so. It then returns the cell object
     * that gets created.
     */
    Narrative.prototype.insertAndSelectCellBelow = function (cellType, index, data) {
        return this.insertAndSelectCell(cellType, 'below', index, data);
    };

    Narrative.prototype.insertAndSelectCellAbove = function (cellType, index, data) {
        return this.insertAndSelectCell(cellType, 'above', index, data);
    };

    Narrative.prototype.insertAndSelectCell = function (cellType, direction, index, data) {
        var newCell;
        if (direction === 'below') {
            newCell = Jupyter.notebook.insert_cell_below(cellType, index, data);
        } else {
            newCell = Jupyter.notebook.insert_cell_above(cellType, index, data);
        }
        Jupyter.notebook.focus_cell(newCell);
        Jupyter.notebook.select(Jupyter.notebook.find_cell_index(newCell));
        this.scrollToCell(newCell);

        return newCell;
    };

    Narrative.prototype.scrollToCell = function (cell, select) {
        var $elem = $('#notebook-container');
        $elem.animate({ scrollTop: cell.element.offset().top + $elem.scrollTop() - $elem.offset().top }, 400);
        if (select) {
            Jupyter.notebook.focus_cell(cell);
            Jupyter.notebook.select(Jupyter.notebook.find_cell_index(cell));
        }
    };

    /**
     * if setHidden === true, then always hide
     * if setHidden === false (not null or undefined), then always show
     * if the setHidden variable isn't present, then just toggle
     */
    Narrative.prototype.toggleSidePanel = function (setHidden) {
        var delay = 'fast';
        var hidePanel = setHidden;
        if (hidePanel === null || hidePanel === undefined) {
            hidePanel = $('#left-column').is(':visible') ? true : false;
        }
        if (hidePanel) {
            $('#left-column').trigger('hideSidePanelOverlay.Narrative');
            $('#left-column').hide('slide', {
                direction: 'left',
                easing: 'swing',
                complete: function () {
                    $('#kb-side-toggle-in').show(0);
                }
            }, delay);
            // Move content flush left-ish
            $('#notebook-container').animate({ left: 0 }, {
                easing: 'swing',
                duration: delay
            });
        } else {
            $('#kb-side-toggle-in').hide(0, function () {
                $('#left-column').show('slide', {
                    direction: 'left',
                    easing: 'swing'
                }, delay);
                $('#notebook-container').animate({ left: 380 }, { easing: 'swing', duration: delay });
            });
        }
    };

    Narrative.prototype.showDataOverlay = function () {
        $(document).trigger('showSidePanelOverlay.Narrative', this.sidePanel.$dataWidget.$overlayPanel);
    };

    Narrative.prototype.hideOverlay = function () {
        $(document).trigger('hideSidePanelOverlay.Narrative');
    };

    /**
     * Registers a KBase widget with the Narrative controller. This lets the
     * controller iterate over the widgets it knows about, so it can do group
     * operations on them.
     */
    Narrative.prototype.registerWidget = function (widget, cellId) {
        this.kbaseWidgets[cellId] = widget;
        $('#' + cellId).bind('destroyed', function () {
            this.removeWidget(cellId);
        }.bind(this));
    };

    Narrative.prototype.removeWidget = function (cellId) {
        delete this.kbaseWidgets[cellId];
    };

    return Narrative;
});
