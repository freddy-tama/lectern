// Pictures from dropped files: a small JPEG the AI can look at, and a right-sized copy for
// the deck so a phone photo doesn't make the PowerPoint file huge.

async function draw(file: Blob, max: number, type: 'image/jpeg' | 'image/png', quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d')!;
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the picture.'))), type, quality));
  } finally {
    bitmap.close();
  }
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]+,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** A small JPEG of a picture, base64, for the AI to see (about 30–80 KB). */
export async function pictureForAi(file: File): Promise<{ mime: 'image/jpeg'; data: string } | null> {
  try {
    return { mime: 'image/jpeg', data: await base64(await draw(file, 640, 'image/jpeg', 0.72)) };
  } catch {
    return null;
  }
}

/** The picture to keep in the deck: large photos are scaled to 1920 px; small ones are kept as they are. */
export async function pictureForDeck(file: File): Promise<File> {
  if (file.size < 1_500_000 || file.type === 'image/gif') return file;
  try {
    const keepAlpha = file.type === 'image/png' && file.size < 4_000_000;
    const blob = await draw(file, 1920, keepAlpha ? 'image/png' : 'image/jpeg', 0.86);
    return blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]+$/, keepAlpha ? '.png' : '.jpg'), { type: blob.type }) : file;
  } catch {
    return file;
  }
}
