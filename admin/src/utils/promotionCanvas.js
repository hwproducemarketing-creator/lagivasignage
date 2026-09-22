/**
 * Generate a 1920×1080 H&W Produce promotional PNG as a data URL.
 */
export async function generatePromotionPng({
  productName = '',
  price = '',
  unit = '',
  description = '',
  productImageUrl = null,
}) {
  const W = 1920;
  const H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#14532D');
  grad.addColorStop(0.45, '#1B5E3B');
  grad.addColorStop(1, '#0F3D28');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Soft accent circle
  ctx.fillStyle = 'rgba(61, 155, 95, 0.25)';
  ctx.beginPath();
  ctx.arc(W - 280, 200, 360, 0, Math.PI * 2);
  ctx.fill();

  // Brand bar
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, 110);
  ctx.fillStyle = '#1B5E3B';
  ctx.font = '700 54px Outfit, Arial, sans-serif';
  ctx.fillText('H&W PRODUCE', 80, 72);

  ctx.fillStyle = '#3D9B5F';
  ctx.font = '600 28px Source Sans 3, Arial, sans-serif';
  ctx.fillText('WEEKLY SPECIAL', 80, 180);

  // Product image area
  const imgBox = { x: 80, y: 230, w: 820, h: 680 };
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, imgBox.x, imgBox.y, imgBox.w, imgBox.h, 24);
  ctx.fill();

  if (productImageUrl) {
    const img = await loadImage(productImageUrl);
    drawContain(ctx, img, imgBox.x + 30, imgBox.y + 30, imgBox.w - 60, imgBox.h - 60);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '500 36px Source Sans 3, Arial, sans-serif';
    ctx.fillText('PRODUCT IMAGE', imgBox.x + 240, imgBox.y + imgBox.h / 2);
  }

  // Right text column
  const tx = 980;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 90px Outfit, Arial, sans-serif';
  wrapText(ctx, (productName || 'PRODUCT').toUpperCase(), tx, 320, 860, 96);

  const priceText = price ? (String(price).startsWith('$') ? String(price) : `$${price}`) : '$0.00';
  ctx.fillStyle = '#A7F3D0';
  ctx.font = '700 140px Outfit, Arial, sans-serif';
  ctx.fillText(priceText, tx, 560);

  if (unit) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 40px Source Sans 3, Arial, sans-serif';
    ctx.fillText(String(unit).toUpperCase(), tx, 640);
  }

  if (description) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '400 36px Source Sans 3, Arial, sans-serif';
    wrapText(ctx, description, tx, 720, 860, 44);
  }

  return canvas.toDataURL('image/png');
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawContain(ctx, img, x, y, w, h) {
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(/\s+/);
  let line = '';
  let yy = y;
  for (let n = 0; n < words.length; n++) {
    const test = line + words[n] + ' ';
    if (ctx.measureText(test).width > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, yy);
      line = words[n] + ' ';
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line.trim(), x, yy);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
