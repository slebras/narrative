(function ($, undefined) {
    return KBWidget({
        name: 'MetagenomeListUploadWidget',
        parent: kbaseAuthenticatedWidget,
        version: '1.0.0',
        ws: null,
        id: null,
        token: null,
        options: {
            ws: null,
            id: null,
        },
        wsUrl: window.kbconfig.urls.workspace,

        init: function (options) {
            this._super(options);
            this.ws = options.ws;
            this.id = options.id;
            return this;
        },

        render: function () {
            const self = this;
            const pref = this.uuid();

            const container = this.$elem;
            container.empty();
            if (self.token == null) {
                container.append("<div>[Error] You're not logged in</div>");
                return;
            }

            container.append(
                '<table class="table table-striped table-bordered" \
            		style="margin-left: auto; margin-right: auto;" id="' +
                    pref +
                    'mglu-table"/>'
            );
            const table = $('#' + pref + 'mglu-table');
            table.append('<tr><td>Target Workspace</td><td>' + self.ws + '</td></tr>');
            table.append('<tr><td>Target Metagenome List Name</td><td>' + self.id + '</td></tr>');
            table.append(
                '<tr><td>URL prefix</td> \
            		<td><input id="' +
                    pref +
                    'mglu-tf" type="text" style="width:100%;"></td></tr>'
            );
            table.append(
                '<tr><td>Data to store<br>(one ID per line)</td> \
            		<td><textarea id="' +
                    pref +
                    'mglu-ta" style="width:100%;" cols="80" rows="8"></textarea></td></tr>'
            );
            container.append(
                '<button class="btn" id="' + pref + 'mglu-btn">Save in workspace</button>'
            );
            container.append(
                '&nbsp;<button class="btn" id="' +
                    pref +
                    'xmpl-btn">Show an example in text area above</button>'
            );
            $('#' + pref + 'mglu-btn').click(() => {
                let urlPref = '' + $('#' + pref + 'mglu-tf').val();
                if (urlPref.length > 0 && urlPref.substr(urlPref.length - 1) != '/') {
                    urlPref += '/';
                }
                const val = $('#' + pref + 'mglu-ta').val();
                const lines = val.split(/\r\n|\r|\n/g);
                const data = [];
                for (const pos in lines) {
                    const line = lines[pos];
                    if (line == '') continue;
                    data.push({ URL: urlPref + line, ID: line });
                }
                const today = new Date();
                let dd = today.getDate();
                let mm = today.getMonth() + 1;
                const yyyy = today.getFullYear();
                const hours = today.getHours();
                const minutes = today.getMinutes();
                const seconds = today.getSeconds();
                if (dd < 10) {
                    dd = '0' + dd;
                }
                if (mm < 10) {
                    mm = '0' + mm;
                }
                date =
                    '' + yyyy + '-' + mm + '-' + dd + ' ' + hours + ':' + minutes + ':' + seconds;
                const mgl = {
                    created: date,
                    name: self.id,
                    type: 'list',
                    members: data,
                };
                const kbws = new Workspace(self.wsUrl, { token: self.token });
                kbws.save_objects(
                    {
                        workspace: self.ws,
                        objects: [{ type: 'Communities.Collection', name: self.id, data: mgl }],
                    },
                    (data) => {
                        alert('Data was successfuly stored in workspace');
                    },
                    (data) => {
                        alert('Error: ' + data.error.message);
                    }
                );
            });
            $('#' + pref + 'xmpl-btn').click(() => {
                $('#' + pref + 'mglu-tf').val('http://kbase.us/services/communities/metagenome/');
                const text =
                    'mgm4549802.3\nmgm4549784.3\nmgm4549797.3\nmgm4549806.3\nmgm4549812.3\n';
                let val = $('#' + pref + 'mglu-ta').val();
                if (val != '') val += '\n';
                val += text;
                $('#' + pref + 'mglu-ta').val(val);
            });
            return this;
        },

        getData: function () {
            return {
                type: 'NarrativeMetagenomeListUploadCard',
                id: this.ws + '.' + this.id,
                workspace: this.options.ws_name,
                title: 'Metagenome List Upload Widget',
            };
        },

        loggedInCallback: function (event, auth) {
            this.token = auth.token;
            this.render();
            return this;
        },

        loggedOutCallback: function (event, auth) {
            this.token = null;
            this.render();
            return this;
        },

        uuid: function () {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = (Math.random() * 16) | 0,
                    v = c == 'x' ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            });
        },
    });
})(jQuery);
