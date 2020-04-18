const _ = require('lodash');
const { ipcRenderer, clipboard } = require('electron');
const path = require('path');
const Dexie = require('dexie');
const db = new Dexie('mydb');
const Vue = require('vue/dist/vue');
const Mousetrap = require('mousetrap');

db.version(1).stores({
    items: '++id, &text, *textWords'
});

db.items.hook("creating", function (primKey, obj, trans) {
    if (typeof obj.text == 'string') obj.textWords = getAllWords(obj.text);
});

db.items.hook("updating", function (mods, primKey, obj, trans) {
    if (mods.hasOwnProperty("text")) {
        // "message" property is being updated
        if (typeof mods.text == 'string')
            // "message" property was updated to another valid value. Re-index messageWords:
            return { textWords: getAllWords(mods.text) };
        else
            // "message" property was deleted (typeof mods.message === 'undefined') or changed to an unknown type. Remove indexes:
            return { textWords: [] };
    }

});

function getAllWords(text) {
    var allWordsIncludingDups = text.split(' ');
    var wordSet = allWordsIncludingDups.reduce(function (prev, current) {
        prev[current] = true;
        return prev;
    }, {});
    return Object.keys(wordSet);
}


const vm = new Vue({
    el: '#app',

    data: {
        clipboardContent: [],
        searchResults: [],
        lastClipboardItem: '',
        clipboardItemCount: 0,
        searchItemCount: 0,
        selectionIndex: -1,
        query: '',
        currentPage: 0,
        currentSearchPage: 0
    },
    watch: {
        query: _.debounce(
            (value) => {
                vm.selectionIndex = -1;
                if (value.length > 0) {
                    vm.searchClipboard(value);
                } else {
                    vm.searchResults = [];
                    vm.currentSearchPage = 0;
                }
            }, 100)
    },
    methods: {

        /**
         * Loads clipboard data from the database in reverse order sorted by id and
         * adds the results to clipboardContent. Only 9 items per page
         * are loaded. The offset is calculated using currentPage.
         *
         * @param {Function} callback Any action that needs to be executed after
         *                            the data is loaded.
         *
         * @param {Boolean} setLastItem Optional. Set to true only on initial load
         *                              to set lastClipboardItem to the last
         *                              value in user's clipboard. It is used to
         *                              determine if the clipboard has chnaged.
         *                              The default is true.
         */
        loadClipboard(callback, setLastItem) {
            setLastItem = setLastItem || false;

            db.items
                .reverse()
                .offset(9 * this.currentPage)
                .limit(9)
                .sortBy('id')
                .then((items) => {

                    this.clipboardContent = items.map((item) => item.text);

                    // Store the last value from the clipboard to check if it has changed.
                    if (items.length > 0 && setLastItem) {
                        this.lastClipboardItem = items[0].text;
                    }
                }).then(callback);
        },

        /**
         * Navigates between pages. It basically just sets currentPage to the
         * given index (0 for the first page, 1 - the second etc.) and  relaods
         * the clipboard.
         *
         * @param {Number} pageIndex
         * @param {Function} callback
         *
         * @see {@link loadClipboard}
         */
        openPage(pageIndex, callback) {
            this.currentPage = pageIndex;

            this.loadClipboard(callback);
        },

        /**
         * Hides app window.
         */
        hideWindow() {
            ipcRenderer.send('hideWindow');
        },

        /**
         * Deletes item from the clipboard history.
         */
        deleteItem() {
            if (this.selectionIndex !== -1) {
                const collection = this.query.length === 0 ? 'clipboardContent' : 'searchResults';
                const clipboardItem = this[collection].splice(this.selectionIndex, 1)[0];

                db.items.where('text').equals(clipboardItem).delete().then((count) => {
                    this.selectionIndex = -1;
                    this.currentPage = 0;
                    this.currentSearchPage = 0;

                    if (this.query.length > 0) {
                        this.searchClipboard(this.query);
                    } else {
                        this.loadClipboard();
                    }
                });
            }
        },

        /**
         * Takes an item from the clipboard collection and moves it to the top of
         * the list.
         */
        copyItem() {
            const collection = this.query.length === 0 ? 'clipboardContent' : 'searchResults';
            const clipboardItem = this[collection].splice(this.selectionIndex, 1)[0];

            // Issue #9. If we select the first item we need to nullify the last
            // clipboard item stored in memory, otherwise it will just disappear form
            // clipboard history.
            if (this.selectionIndex === 0) {
                this.lastClipboardItem = null;
            }

            db.items
                .where('text').equals(clipboardItem)
                .delete()
                .then((count) => {
                    this.clipboardItemCount -= count;

                    // Navigate back to the first page because the selected item is now
                    // at the very top of the list.
                    this.openPage(0, () => {
                        clipboard.writeText(clipboardItem);

                        this.selectionIndex = -1;
                        this.query = '';
                        this.currentSearchPage = 0;

                        this.hideWindow();
                    });
                });
        },

        /**
         * Performs a clipboard search with the given search needle.
         *
         * @param {String} needle
         */
        searchClipboard(needle) {

            async function find(prefixes) {

                console.log(prefixes)

                // Parallell search for all prefixes - just select resulting primary keys
                const results = await Promise.all(prefixes.map(prefix =>
                    db.items
                        .where('textWords')
                        .startsWithIgnoreCase(prefix)
                        .primaryKeys()));

                // Intersect result set of primary keys
                const reduced = await results
                    .reduce((a, b) => {
                        const set = new Set(b);
                        return a.filter(k => set.has(k));
                    });

                // Finally select entire documents from intersection
                return db.items
                    .where('id')
                    .anyOf(reduced)
                    .reverse()
                    .distinct()
                    .offset(9 * vm.currentSearchPage)
                    .limit(9)
                    .sortBy('id');
            }

            query_words = getAllWords(needle)

            find(query_words)
                .then((items) => {
                    vm.searchItemCount = items.length;
                    vm.searchResults = items.map((item) => item.text);
                });

        },

        /**
         * Assigns actions to specifickeyboard events.
         */
        initActionKeys() {
            Mousetrap.bind('up', () => {
                if (this.selectionIndex === 0) {
                    this.selectionIndex = this.clipboardContent.length - 1;
                } else {
                    this.selectionIndex--;
                }
            });

            Mousetrap.bind('right', () => {
                if (this.query.length === 0) {
                    if ((Math.ceil(this.clipboardItemCount / 9)) > this.currentPage + 1) {
                        this.openPage(this.currentPage + 1);
                    }
                } else {
                    this.currentSearchPage++;
                    this.searchClipboard(this.query);
                }
            });

            Mousetrap.bind('down', () => {
                if (this.selectionIndex == this.clipboardContent.length - 1) {
                    this.selectionIndex = 0;
                } else {
                    this.selectionIndex++;
                }
            });

            Mousetrap.bind('left', () => {
                if (this.query.length === 0) {
                    if (this.currentPage > 0) {
                        this.openPage(this.currentPage - 1);
                    }
                } else {
                    this.currentSearchPage--;
                    this.searchClipboard(this.query);
                }
            });

            Mousetrap.bind('esc', this.hideWindow);
            Mousetrap.bind('enter', this.copyItem);

            if (process.platform === 'darwin') {
                Mousetrap.bind('command+backspace', this.deleteItem);
            } else {
                Mousetrap.bind('ctrl+backspace', this.deleteItem);
            }
        }
    },

    /**
     * Initializes the application.
     */
    mounted() {

        db.items.count((count) => {
            this.clipboardItemCount = count;
        });

        this.loadClipboard(() => {
            // NOTE: MacOS has no native interface to listen for clipboard changes,
            // therefore, polling is the only option. We should do as little
            // processing as possible in this function to preserve system resources.
            // TODO: Windows has an interface for this purpose. We should at least
            // try to integrate it in the app.
            setInterval(() => {
                const clipboardText = clipboard.readText();

                if (clipboardText.length > 0 && clipboardText != this.lastClipboardItem) {
                    // Delete the item if it's already in the clipboard to avoid extra checks.
                    db.items.where('text').equals(clipboardText).delete()
                        .then((count) => {
                            // TODO: try to remove the item without checking if it's in the array!
                            if (this.clipboardContent.includes(clipboardText)) {
                                const clipboardItem = this.clipboardContent.splice(
                                    this.clipboardContent.indexOf(clipboardText), 1
                                )[0];
                            } else if (this.clipboardContent.length === 9) {
                                this.clipboardContent.pop();
                            }

                            this.clipboardItemCount -= count;
                        })
                        .then(() => {
                            this.clipboardContent.unshift(clipboardText);
                            db.items.add({ text: clipboardText });
                            this.lastClipboardItem = clipboardText;
                            this.clipboardItemCount++;
                        });
                }
            }, 300);
        }, true);

        ipcRenderer.on('clearClipboardHistory', () => {
            db.items.clear().then(() => {
                this.lastClipboardItem = '';
                this.clipboardItemCount = 0;
                this.selectionIndex = -1;
                this.query = '';
                this.openPage(0);
            });
        });

        ipcRenderer.on('exportClipboardHistoryAsJSON', () => {
            db.items.toArray().then((items) => {
                ipcRenderer.send('saveExportedData', { items: JSON.stringify(items), format: 'json' })
            });
        });

        ipcRenderer.on('exportClipboardHistoryAsTXT', () => {
            db.items.toArray().then((items) => {
                ipcRenderer.send('saveExportedData', {
                    items: items.map((item) => item.text).join('\n'),
                    format: 'txt'
                })
            });
        });

        this.initActionKeys();
    }
});