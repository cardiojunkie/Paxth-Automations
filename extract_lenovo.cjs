const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to exact iframe URL...');
  // The iframe src was /Product/ThinkPad/ThinkPad_E16_Gen_4_Intel?tab=spec
  await page.goto('https://psref.lenovo.com/Product/ThinkPad/ThinkPad_E16_Gen_4_Intel?tab=spec', { waitUntil: 'networkidle' });
  console.log('Loaded.');
  
  const html = await page.content();
  fs.writeFileSync('lenovo_playwright_iframe.html', html);
  
  const classes = await page.evaluate(() => {
    const results = [];
    // find elements that contain text "Performance" or have id/class with "spec"
    const elements = document.querySelectorAll('.right_Show, .flow_show, .content_root, .product_first, .product_children, .full_product, table, div');
    
    for (let el of elements) {
      if (el.textContent && el.textContent.trim().toUpperCase() === 'PERFORMANCE' || el.textContent.includes('Performance')) {
        if (!el.children.length || el.tagName === 'TH' || el.tagName === 'TD' || el.tagName === 'H3' || el.tagName === 'DIV') {
            const rowInfo = {
                tag: el.tagName,
                className: el.className,
                id: el.id,
                text: el.textContent.trim().substring(0, 50)
            };
            results.push(rowInfo);
        }
      }
    }
    
    // specifically look for the tables or nested divs inside specs
    const tables = document.querySelectorAll('table');
    const tableInfo = Array.from(tables).map(t => t.className);
    
    return {
      results: results.slice(0, 10),
      tables: tableInfo
    };
  });
  
  console.log('Results:', JSON.stringify(classes, null, 2));
  await browser.close();
})();
