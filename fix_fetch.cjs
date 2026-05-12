const fs = require('fs');
let appPath = './src/App.tsx';
let authWrapperPath = './src/AuthWrapper.tsx';

// For App.tsx
let appContent = fs.readFileSync(appPath, 'utf8');
appContent = 'import { apiFetch } from "./auth";\n' + appContent;
appContent = appContent.replace(/fetch\(/g, 'apiFetch(');
fs.writeFileSync(appPath, appContent);

let authWrapperContent = fs.readFileSync(authWrapperPath, 'utf8');
authWrapperContent = authWrapperContent.replace(/import \{ useAuth, signIn, signOut \} from '\.\/auth';/, "import { useAuth, signIn, signOut, apiFetch } from './auth';");
authWrapperContent = authWrapperContent.replace(/fetch\(/g, 'apiFetch(');
fs.writeFileSync(authWrapperPath, authWrapperContent);
console.log("Done");
