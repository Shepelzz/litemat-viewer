// Fixed showcase pages (thumb: shipped picture for the recent list, so it isn't blank before the first visit): /<path>/ always opens public/<file>, shown like the demo (not added to recent files,
// doesn't change what the main page reopens). vite.config.js emits a page per entry; main.js picks it by URL.
export const SHOWCASES = {
  beehive: { file: 'beehive.litematic', title: 'Beehive', dims: '904×200×1006', thumb: 'thumbs/beehive.jpg' },
};
