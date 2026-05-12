import { createRequire } from 'module';
const __require = createRequire(import.meta.url);
const pdfParse = __require('pdf-parse');
console.log(typeof pdfParse);
