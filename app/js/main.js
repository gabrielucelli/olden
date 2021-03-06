const _ = require('lodash');
const { ipcRenderer, clipboard } = require('electron');
const Dexie = require('dexie');
const db = new Dexie('mydb');
const Vue = require('vue/dist/vue');
const Mousetrap = require('mousetrap');

db.version(1).stores({
    items: '++id, &text'
})

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
                    vm.query = value
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
                        this.hideWindow();
                        this.selectionIndex = -1;
                        this.query = '';
                        this.currentSearchPage = 0;
                        
                    });
                });
        },

        /**
         * Performs a clipboard search with the given search needle.
         *
         * @param {String} needle
         */
        searchClipboard(needle) {

            function slugify (str) {
                var map = {
                    '-' : ' ',
                    '-' : '_',
                    'a' : 'á|à|ã|â|À|Á|Ã|Â',
                    'e' : 'é|è|ê|É|È|Ê',
                    'i' : 'í|ì|î|Í|Ì|Î',
                    'o' : 'ó|ò|ô|õ|Ó|Ò|Ô|Õ',
                    'u' : 'ú|ù|û|ü|Ú|Ù|Û|Ü',
                    'c' : 'ç|Ç',
                    'n' : 'ñ|Ñ'
                };
                
                str = str.toLowerCase();
                
                for (var pattern in map) {
                    str = str.replace(new RegExp(map[pattern], 'g'), pattern);
                };
            
                return str;
            };

            async function find(query) {
                return db.items.reverse().filter(function(item) {
                    return slugify(item.text).indexOf(slugify(query)) !== -1;
                })
                .offset(9 * vm.currentSearchPage)
                .limit(9)
                .toArray();
            }

            find(needle)
                .then((items) => {
                    vm.searchResults = items.map((item) => item.text);
                    vm.searchItemCount = items.length;
                }, (e) => {
                    console.log(e)
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
                        this.openPage(this.currentPage + 1, () => {
                            if(this.clipboardContent.length - 1 < this.selectionIndex) {
                                this.selectionIndex = this.clipboardContent.length - 1
                            }
                        });
                    }
                } else {
                    if ((Math.ceil(this.searchItemCount / 9)) > this.currentSearchPage + 1) {
                        this.currentSearchPage++;
                        this.searchClipboard(this.query);
                    }
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