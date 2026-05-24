
import * as pdfjs from 'pdfjs-dist';

// Set worker path
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export async function pdfToImages(file: File): Promise<string[]> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const images: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await (page as any).render({ canvasContext: ctx, viewport }).promise;
      images.push(canvas.toDataURL('image/png'));
    }

    return images;
  } catch (error: any) {
    console.error("PDF processing error:", error);
    throw new Error(error?.message || "Failed to process PDF file");
  }
}

function getExactBounds(imageData: ImageData) {
  const { data, width, height } = imageData;
  
  const isBg = (r: number, g: number, b: number, a: number) => {
    if (a < 10) return true; // transparent
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    
    // Very light/white/off-white (typical webtoon gutters)
    if (max > 220 && (max - min) < 25) return true;
    
    // Very dark/black gutters
    if (max < 30) return true;
    
    return false;
  };

  const xThreshold = Math.max(5, Math.floor(width * 0.01));
  const yThreshold = Math.max(5, Math.floor(height * 0.01));

  let top = 0;
  while (top < height) {
    let contentPixels = 0;
    for (let x = 0; x < width; x++) {
      const i = (top * width + x) * 4;
      if (!isBg(data[i], data[i+1], data[i+2], data[i+3])) contentPixels++;
      if (contentPixels > xThreshold) break;
    }
    if (contentPixels > xThreshold) break; 
    top++;
  }

  let bottom = height - 1;
  while (bottom > top) {
    let contentPixels = 0;
    for (let x = 0; x < width; x++) {
      const i = (bottom * width + x) * 4;
      if (!isBg(data[i], data[i+1], data[i+2], data[i+3])) contentPixels++;
      if (contentPixels > xThreshold) break;
    }
    if (contentPixels > xThreshold) break;
    bottom--;
  }

  let left = 0;
  while (left < width) {
    let contentPixels = 0;
    for (let y = top; y <= bottom; y++) {
      const i = (y * width + left) * 4;
      if (!isBg(data[i], data[i+1], data[i+2], data[i+3])) contentPixels++;
      if (contentPixels > yThreshold) break;
    }
    if (contentPixels > yThreshold) break;
    left++;
  }

  let right = width - 1;
  while (right > left) {
    let contentPixels = 0;
    for (let y = top; y <= bottom; y++) {
      const i = (y * width + right) * 4;
      if (!isBg(data[i], data[i+1], data[i+2], data[i+3])) contentPixels++;
      if (contentPixels > yThreshold) break;
    }
    if (contentPixels > yThreshold) break;
    right--;
  }

  return { top, bottom, left, right };
}

export async function cropImage(imageUrl: string, rect: { x: number; y: number; width: number; height: number }, autoTrim: boolean = false): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject("Could not get canvas context");

      // rect is normalized 0-1000
      const realX = (rect.x / 1000) * img.width;
      const realY = (rect.y / 1000) * img.height;
      const realW = (rect.width / 1000) * img.width;
      const realH = (rect.height / 1000) * img.height;

      if (!autoTrim) {
        // Fast path for manual crop without trimming
        canvas.width = realW;
        canvas.height = realH;
        ctx.drawImage(img, realX, realY, realW, realH, 0, 0, realW, realH);
        resolve(canvas.toDataURL('image/png'));
        return;
      }

      // Add a safety margin for auto-detection to catch missed edges
      const margin = 15;
      const cropX = Math.max(0, realX - margin);
      const cropY = Math.max(0, realY - margin);
      const cropW = Math.min(img.width - cropX, realW + (margin * 2));
      const cropH = Math.min(img.height - cropY, realH + (margin * 2));

      canvas.width = cropW;
      canvas.height = cropH;
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      const scannedData = ctx.getImageData(0, 0, cropW, cropH);
      const bounds = getExactBounds(scannedData);
      
      const contentW = bounds.right - bounds.left;
      const contentH = bounds.bottom - bounds.top;

      if (contentW <= 15 || contentH <= 15) {
        resolve(null);
        return;
      }

      // Density check: if the "content" is actually just 99% background noise, drop it entirely
      if (autoTrim) {
        // Also drop extremely narrow slices that are just borders
        if (contentW < img.width * 0.05 || contentH < img.height * 0.02) {
          resolve(null);
          return;
        }

        let inkPixels = 0;
        
        // Use a local isBg to ensure alpha and density calculations are flawless
        const isBgLightLocal = (r: number, g: number, b: number, a: number) => {
          if (a < 10) return true;
          if (r > 245 && g > 245 && b > 245) return true;
          if (r < 10 && g < 10 && b < 10) return true;
          return false;
        };
        
        for (let y = bounds.top; y <= bounds.bottom; y += 3) {
          for (let x = bounds.left; x <= bounds.right; x += 3) {
            const i = (y * cropW + x) * 4;
            if (!isBgLightLocal(scannedData.data[i], scannedData.data[i+1], scannedData.data[i+2], scannedData.data[i+3])) {
              inkPixels++;
            }
          }
        }
        const sampleArea = Math.ceil(contentW / 3) * Math.ceil(contentH / 3);
        const inkDensity = inkPixels / sampleArea;
        
        if (inkDensity < 0.005) {
          resolve(null);
          return;
        }
      }

      // Add a tiny padding to the final cropped output
      const pad = 2;
      const finalCanvas = document.createElement('canvas');
      const finalCtx = finalCanvas.getContext('2d');
      if (!finalCtx) return reject("Context error");

      finalCanvas.width = contentW + (pad * 2);
      finalCanvas.height = contentH + (pad * 2);
      
      // Fill background (optional, using white)
      finalCtx.fillStyle = '#FFFFFF';
      finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

      finalCtx.putImageData(
        ctx.getImageData(bounds.left, bounds.top, contentW, contentH), 
        pad, pad
      );
      
      resolve(finalCanvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error("Failed to load image for cropping"));
    img.src = imageUrl;
  });
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file as base64"));
    reader.readAsDataURL(file);
  });
}

export function isBlankImage(base64: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 30;
      canvas.height = 30;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(false);
        return;
      }
      ctx.drawImage(img, 0, 0, 30, 30);
      try {
        const imgData = ctx.getImageData(0, 0, 30, 30);
        const data = imgData.data;
        let whitePixels = 0;
        let blackPixels = 0;
        const total = 30 * 30;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i+1];
          const b = data[i+2];
          const a = data[i+3];

          if (a < 10) {
            whitePixels++;
            continue;
          }

          // Check if white or very light off-white
          if (r > 240 && g > 240 && b > 240) {
            whitePixels++;
          }
          // Check if black or very dark
          else if (r < 25 && g < 25 && b < 25) {
            blackPixels++;
          }
        }

        const whiteRatio = whitePixels / total;
        const blackRatio = blackPixels / total;

        if (whiteRatio > 0.95 || blackRatio > 0.95) {
          resolve(true);
        } else {
          resolve(false);
        }
      } catch (err) {
        console.error("Error reading image data in isBlankImage:", err);
        resolve(false);
      }
    };
    img.onerror = () => {
      resolve(false);
    };
    img.src = base64;
  });
}

