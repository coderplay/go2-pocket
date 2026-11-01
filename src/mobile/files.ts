import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function exportFile(filename: string, blob: Blob): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const data = await new Promise<string>((resolve,reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject; reader.readAsDataURL(blob);
    });
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const file = await Filesystem.writeFile({ path: `exports/${Date.now()}-${safeName}`, data,
      directory: Directory.Cache, recursive: true });
    await Share.share({ title: filename, files: [file.uri] });
    return;
  }
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
