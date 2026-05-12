const XLSX = require('xlsx');
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet([{a:1,b:2}]);
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
try {
  XLSX.write(wb, { type: 'buffer', bookType: 'xls' });
  console.log('bookType: xls works');
} catch (e) {
  console.log('bookType: xls failed: ' + e.message);
}
try {
  XLSX.write(wb, { type: 'buffer', bookType: 'biff8' });
  console.log('bookType: biff8 works');
} catch (e) {
  console.log('bookType: biff8 failed: ' + e.message);
}
