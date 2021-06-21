//@format
//@flow strict

/*:: type PDFParsedOutputText = {
    text: string,
    x: number,
    y: number,
    h: number,
    w: number,
    ry: number,
    R: Array<{TS: string}>,
} */

/*:: type PDFParsedOutputTextRow = Array<PDFParsedOutputText> */

/*:: type PDFParsedOutput = Array<{
    Texts: Array<Array<PDFParsedOutputText>>,
    VLines: Array<{ l: number, y: number, x: number, ry: number }>,
    HLines: Array<{ y: number, x: number, l: number, ry: number }>,
    Fills: Array<{ h: number, l: number, y: number, x: number, w: number }>,
    Height: number,
}>*/

/*:: type Section = Array<PDFParsedOutputTextRow> */

const PDFParser = require('pdf2json');
const getJson = buffer => {
  return new Promise((res, rej) => {
    const pdfParser = new PDFParser();
    pdfParser.on('pdfParser_dataError', errData => rej(errData.parserError));
    pdfParser.on('pdfParser_dataReady', pdfData => {
      res(pdfData);
    });
    pdfParser.parseBuffer(buffer);
  });
};

const fixItems = (pageIdx, pageY, items, isText = false) => {
  const fixedItems = items.map(v => {
    if (isText && v.R) {
      v.text = decodeURIComponent(v.R.map(r => r.T).join(' '));
      v.aw = v.w / 16;
      v.x = v.x + 0.25; // Every text start seems to be out by 0.25
      v.y = v.y + 0.35; // + 1; // + v.h;
      v.h = v.R[0].TS[1] - 3 - 3;
    }
    v.page = pageIdx;
    v.ry = pageY + v.y;
    return v;
  });
  return fixedItems;
};

module.exports = async (
  buffer /*: Buffer */,
  options /*: { convertFillsToLines?: boolean, gatherRowsDelta?: number } */ = {},
) /*: Promise<PDFParsedOutput> */ => {
  const data = await getJson(buffer);
  var accumulativePageY = 0;
  const Width = data.formImage.Width;
  const pages = data.formImage.Pages.map((page, i) => {
    if (options.convertFillsToLines) {
      page.Fills.forEach(fill => {
        page.HLines.push({x: fill.x, y: fill.y, w: 0.968, l: fill.w});
        page.HLines.push({x: fill.x, y: fill.y + fill.h, w: 0.968, l: fill.w});
        page.VLines.push({crl: 3, x: fill.x, y: fill.y, w: 0.75, l: fill.h});
        page.VLines.push({crl: 3, x: fill.x + fill.w, y: fill.y, w: 0.75, l: fill.h});
      });
      page.Fills = [];
    }
    page.y = accumulativePageY;
    accumulativePageY += page.Height;
    page.Texts = fixItems(i, page.y, page.Texts, true);
    page.HLines = fixItems(i, page.y, page.HLines);
    page.VLines = fixItems(i, page.y, page.VLines);
    page.Boxsets = fixItems(i, page.y, page.Boxsets);
    page.Fields = fixItems(i, page.y, page.Fields);
    page.Fills = fixItems(i, page.y, page.Fills);

    const closestRow = (currentRows, y) => {
      if (currentRows.length === 0) {
        return y;
      }

      if (options.gatherRowsDelta && options.gatherRowsDelta > 0) {
        const closest = currentRows.reduce((a, v) => {
          if (!a) {
            return v;
          }
          const currentV = parseFloat(v);
          const diff = Math.abs(y - currentV);
          if (diff < Math.abs(y - a)) {
            return v;
          }
          return a;
        }, null);
        if (closest && Math.abs(closest - y) < (options.gatherRowsDelta || 0)) {
          return closest;
        }
        return y;
      }
      return y;
    };
    // Convert each text on the page into rows of text, based on the y value
    const gatherRows = page.Texts.reduce((a, v) => {
      const y = closestRow(Object.keys(a), v.y);
      if (!a[y]) {
        a[y] = [];
      }
      a[y].push(v);
      return a;
    }, {});

    // Sort the gathered rows into order based on the key, and and build the rows array
    const rows = Object.keys(gatherRows)
      .sort((a, b) => parseFloat(a) - parseFloat(b))
      .map(k => gatherRows[k]);

    // Now sort each row so the words are in the correct order based on the x value
    const sortedRows = rows.sort((a, b) => a.x - b.x);
    return {
      Width,
      ...page,
      Texts: sortedRows,
    };
  });
  return pages;
};
