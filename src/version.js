// Version und Build-Kennung werden beim Build von Vite eingesetzt (siehe vite.config.js).
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'lokal';
