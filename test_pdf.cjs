const pdf = require('pdf-parse');

async function test() {
  try {
    const dummyPdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT\n/F1 24 Tf\n100 100 Td\n(Hello World) Tj\nET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000249 00000 n \n0000000343 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n431\n%%EOF\n", 
      "ascii"
    );

    const parser = new pdf.PDFParse();
    const data = await parser.load(dummyPdf);
    console.log(data);
    const text = await parser.getText();
    console.log("TEXT:\n", text);

  } catch (e) {
    console.error(e);
  }
}
test();
