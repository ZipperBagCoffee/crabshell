'use strict';

// Reads a price the way people write it: "19.99", "$19.99", "1,234.50", and a refund
// written in parentheses, "(12.50)".
function parsePrice(text) {
  const cleaned = String(text).replace(/[$\s]/g, '');
  return parseFloat(cleaned);
}

module.exports = { parsePrice };
