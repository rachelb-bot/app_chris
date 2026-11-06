// Browser stand-ins for node:fs, node:path, node:url, multer and nodemailer in the preview build.
export const mkdirSync = () => {};
export const rm = (_p, _o, cb) => cb && cb();
export const existsSync = () => false;
export const join = (...p) => p.filter(Boolean).join('/');
export const resolve = (...p) => p.filter(Boolean).join('/');
export const dirname = (p) => String(p).split('/').slice(0, -1).join('/');
export const extname = (p) => { const m = /\.[^./]*$/.exec(String(p)); return m ? m[0] : ''; };
export const fileURLToPath = () => '/preview';
const uploadsOff = () => (_req, _res, next) => next(Object.assign(new Error('File uploads are switched off in this preview.'), { status: 400 }));
export function multer() { return { array: uploadsOff, single: uploadsOff }; }
multer.diskStorage = () => ({});
export const createTransport = () => ({ sendMail: async () => ({}) });
export default { mkdirSync, rm, existsSync, join, resolve, dirname, extname, fileURLToPath, createTransport, diskStorage: multer.diskStorage };
