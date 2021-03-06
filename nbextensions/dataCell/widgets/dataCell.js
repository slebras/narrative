define([
    'common/runtime',
    'common/busEventManager',
    'common/props',
    'common/ui',
    'common/html',
    'common/jupyter',
], (Runtime, BusEventManager, Props, UI, html, Jupyter) => {
    'use strict';

    const t = html.tag,
        div = t('div'),
        p = t('p');

    function factory(config) {
        let cell = config.cell,
            runtime = Runtime.make(),
            eventManager = BusEventManager.make({
                bus: runtime.bus(),
            }),
            bus = runtime.bus().makeChannelBus({ description: 'data cell bus' }),
            // To be instantiated at attach()
            container,
            ui,
            // To be instantiated in start()
            cellBus;

        function doDeleteCell() {
            const content = div([
                p([
                    'Deleting this cell will remove the data visualization, ',
                    'but will not delete the data object, which will still be available ',
                    'in the data panel.',
                ]),
                p('Continue to delete this data cell?'),
            ]);
            ui.showConfirmDialog({ title: 'Confirm Cell Deletion', body: content }).then(
                (confirmed) => {
                    if (!confirmed) {
                        return;
                    }

                    bus.emit('stop');

                    Jupyter.deleteCell(cell);
                }
            );
        }

        // Widget API

        eventManager.add(
            bus.on('run', (message) => {
                container = message.node;
                ui = UI.make({ node: container });

                // Events for comm from the parent.
                eventManager.add(
                    bus.on('stop', () => {
                        eventManager.removeAll();
                    })
                );

                // The cell bus is for communication via the common id.
                // This allows disassociated elements to communicate with us
                // without a physical handle on the widget object.

                cellBus = runtime.bus().makeChannelBus({
                    name: {
                        cell: Props.getDataItem(cell.metadata, 'kbase.attributes.id'),
                    },
                    description: 'A cell channel',
                });

                eventManager.add(
                    cellBus.on('delete-cell', () => {
                        doDeleteCell();
                    })
                );
            })
        );

        return {
            bus: bus,
        };
    }

    return {
        make: function (config) {
            return factory(config);
        },
    };
});
