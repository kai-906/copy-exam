const fs = require('fs');
const path = require('path');

console.log('🔍 Starting Project Folder Audit...\n');

const requiredFolders = ['controllers', 'middleware', 'public', 'uploads'];
requiredFolders.forEach(folder => {
  const dirPath = path.join(__dirname, folder);
  if (fs.existsSync(dirPath)) {
    console.log(`✅ Directory [${folder}] exists.`);
  } else {
    console.log(`❌ MISSING Directory: [${folder}] - Creating now...`);
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

console.log('\n🔍 Verifying Essential Controller Files...');
const controllers = ['authController.js', 'bankController.js', 'examController.js', 'studentController.js', 'teacherController.js'];

controllers.forEach(file => {
  const filePath = path.join(__dirname, 'controllers', file);
  if (fs.existsSync(filePath)) {
    console.log(`✅ Controller Found: ${file}`);
  } else {
    console.log(`⚠️ Warning: Missing Controller [${file}]`);
  }
});

console.log('\n🎉 Audit Checks Completed!');