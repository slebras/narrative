/**
 * KBase widget to display table of BIOM data
 */
define([
    'kbwidget',
    'bootstrap',
    'jquery',
    'narrativeConfig',
    'kbaseAuthenticatedWidget',
    'kbStandaloneTable',
], (KBWidget, bootstrap, $, Config, kbaseAuthenticatedWidget, kbStandaloneTable) => {
    return KBWidget({
        name: 'AbundanceDataTable',
        parent: kbaseAuthenticatedWidget,
        version: '1.0.0',
        token: null,
        options: {
            id: null,
            ws: null,
            name: 0,
        },
        ws_url: Config.url('workspace'),
        loading_image: Config.get('loading_gif'),

        init: function (options) {
            this._super(options);
            return this;
        },

        render: function () {
            const self = this;
            const pref = this.uuidv4();

            const container = this.$elem;
            container.empty();
            if (self.token == null) {
                container.append("<div>[Error] You're not logged in</div>");
                return;
            }
            container.append(
                '<div><img src="' + self.loading_image + '">&nbsp;&nbsp;loading data...</div>'
            );

            const kbws = new Workspace(self.ws_url, { token: self.token });
            kbws.get_objects(
                [{ ref: self.options.ws + '/' + self.options.id }],
                (data) => {
                    container.empty();
                    // parse data
                    if (data.length == 0) {
                        const msg =
                            '[Error] Object ' +
                            self.options.id +
                            ' does not exist in workspace ' +
                            self.options.ws;
                        container.append('<div><p>' + msg + '>/p></div>');
                    } else {
                        const biom = data[0]['data'];
                        let matrix = [];
                        var tdata = [];
                        // get matrix
                        if (biom['matrix_type'] == 'sparse') {
                            matrix = self.sparse2dense(
                                biom['data'],
                                biom['shape'][0],
                                biom['shape'][1]
                            );
                        } else {
                            matrix = biom['data'];
                        }
                        // get column names
                        const clength = biom['columns'].length + 1;
                        const cnames = new Array(clength);
                        cnames[0] = 'Annotation';
                        for (var c = 0; c < biom['columns'].length; c++) {
                            if (self.options.name == 0) {
                                cnames[c + 1] = biom['columns'][c]['id'];
                            } else {
                                if (biom['columns'][c].hasOwnProperty('name')) {
                                    cnames[c + 1] = biom['columns'][c]['name'];
                                } else {
                                    cnames[c + 1] = biom['columns'][c]['id'];
                                }
                            }
                        }
                        // add values
                        var tdata = new Array(matrix.length);
                        for (let r = 0; r < matrix.length; r++) {
                            tdata[r] = new Array(clength);
                            tdata[r][0] = biom['rows'][r]['id'];
                            for (var c = 0; c < matrix[r].length; c++) {
                                let value = Math.round(matrix[r][c] * 1000) / 1000;
                                if (!value) {
                                    value = '0';
                                }
                                tdata[r][c + 1] = value;
                            }
                        }
                        // TABLE
                        let tlen = 0;
                        if (window.hasOwnProperty('rendererTable') && rendererTable.length) {
                            tlen = rendererTable.length;
                        }
                        container.append(
                            "<div id='outputTable" + tlen + "' style='width: 95%;'></div>"
                        );
                        const tableTest = standaloneTable.create({ index: tlen });
                        tableTest.settings.target = document.getElementById('outputTable' + tlen);
                        tableTest.settings.data = { header: cnames, data: tdata };
                        tableTest.settings.filter = { 0: { type: 'text' } };
                        const mw = [120];
                        for (let i = 1; i < cnames.length; i++) {
                            mw.push(130);
                        }
                        tableTest.settings.minwidths = mw;
                        tableTest.render(tlen);
                    }
                },
                (data) => {
                    container.empty();
                    const main = $('<div>');
                    main.append(
                        $('<p>')
                            .css({ padding: '10px 20px' })
                            .text('[Error] ' + data.error.message)
                    );
                    container.append(main);
                }
            );
            return self;
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

        sparse2dense: function (sparse, rmax, cmax) {
            const dense = new Array(rmax);
            // dense matrix of 0's
            for (var i = 0; i < rmax; i++) {
                dense[i] = Array.apply(null, new Array(cmax)).map(Number.prototype.valueOf, 0);
            }
            for (var i = 0; i < sparse.length; i++) {
                dense[sparse[i][0]][sparse[i][1]] = sparse[i][2];
            }
            return dense;
        },

        uuidv4: function (a, b) {
            for (
                b = a = '';
                a++ < 36;
                b +=
                    (a * 51) & 52
                        ? (a ^ 15 ? 8 ^ (Math.random() * (a ^ 20 ? 16 : 4)) : 4).toString(16)
                        : '-'
            );
            return b;
        },
    });
});
