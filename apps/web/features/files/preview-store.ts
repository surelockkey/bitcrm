import { create } from "zustand";

/**
 * Файл, який показують у вікні перегляду.
 *
 * Посилання не зберігається, а береться на місці: підписані URL живуть
 * хвилини, і той, що склали на малюванні списку, до кліку вже прострочений.
 * Тому кожне місце дає свій спосіб його дістати.
 */
export interface PreviewFile {
  name: string;
  /** MIME з картки файлу, якщо він там є; інакше тип вгадується з назви. */
  contentType?: string;
  /** Взяти посилання на вміст — саме в мить відкриття. */
  load: () => Promise<string>;
}

interface FilePreviewState {
  file: PreviewFile | null;
  preview: (file: PreviewFile) => void;
  close: () => void;
}

/**
 * Одне вікно перегляду на весь застосунок: вкладення є і в роботі, і в
 * документах техніка, і в переписці, і в довільному полі-файлі.
 */
export const useFilePreviewStore = create<FilePreviewState>((set) => ({
  file: null,
  preview: (file) => set({ file }),
  close: () => set({ file: null }),
}));

const extensionOf = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"]);

export function isImage(file: PreviewFile): boolean {
  return file.contentType
    ? file.contentType.startsWith("image/")
    : IMAGE_EXTENSIONS.has(extensionOf(file.name));
}

export function isPdf(file: PreviewFile): boolean {
  return file.contentType ? file.contentType === "application/pdf" : extensionOf(file.name) === "pdf";
}
