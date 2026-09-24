"use client";

import { useCallback, useState } from "react";

/**
 * Сторінки поверх курсорного списку.
 *
 * DynamoDB віддає наступну сторінку лише за курсором попередньої, тож «одразу
 * на сьому» не буває: вперед — це довантаження, назад — миттєво, бо пройдене
 * вже в руках. Звідси й вигляд: номери рівно тих сторінок, куди можна
 * потрапити, а не порожня обіцянка з тисячею номерів.
 */
export interface PagedSource<T> {
  /** Сторінки, як їх склав `useInfiniteQuery`: кожна — вже готовий рядок таблиці. */
  pages: T[][];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  fetchNextPage: () => Promise<unknown>;
}

export interface PagerOptions {
  /** Скільки всього рядків, якщо сервер це знає (напр. `/deals/counts`). */
  total?: number;
  /** `total` — це «не менше»: лічильник сервера спинився на стелі. */
  totalIsFloor?: boolean;
  /** Змінився — фільтри під списком інші, гортання починається спочатку. */
  resetKey?: string;
}

export interface Pager<T> {
  page: number;
  items: T[];
  /** Номер першого рядка сторінки в наскрізній нумерації, з одиниці. */
  from: number;
  to: number;
  total?: number;
  totalIsFloor?: boolean;
  canPrev: boolean;
  canNext: boolean;
  isLoading: boolean;
  isFetching: boolean;
  /** Сторінки, які можна натиснути: завантажені плюс та, що за курсором. */
  window: (number | "…")[];
  next: () => Promise<void>;
  prev: () => void;
  /** Асинхронний: сусідня сторінка за краєм спершу довантажується. */
  goto: (page: number) => Promise<void>;
}

export function usePager<T>(src: PagedSource<T>, options: PagerOptions): Pager<T> {
  const { total, totalIsFloor, resetKey } = options;
  const [page, setPage] = useState(1);

  // Фільтри під списком змінились — сторінки старого набору більше ні про що
  // не свідчать. Скидання під час рендера, а не в ефекті: інакше кадр
  // показував би третю сторінку нового набору, якої ще немає. Попереднє
  // значення тримає стан, а не ref: під час рендера ref читати не можна.
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    if (page !== 1) setPage(1);
  }

  const loaded = src.pages.length;
  const current = Math.min(page, Math.max(loaded, 1));
  const items = src.pages[current - 1] ?? [];

  const goto = useCallback(
    async (target: number) => {
      if (target < 1) return;
      if (target <= loaded) {
        setPage(target);
        return;
      }
      // Рівно одна сторінка за краєм — її відкриє курсор тієї, що вже є.
      // Далі не сягнути: восьма без сьомої не існує, і клік у порожнечу
      // краще не робити виглядом переходу.
      if (target > loaded + 1 || !src.hasNextPage || src.isFetchingNextPage) return;
      // Спершу сторінка в руках, потім перехід: якщо запит упаде, гортання
      // лишиться там, де було, а не на порожнечі.
      await src.fetchNextPage();
      setPage(target);
    },
    [loaded, src],
  );

  const next = useCallback(() => goto(current + 1), [current, goto]);

  const prev = useCallback(() => setPage((p) => Math.max(1, Math.min(p, loaded) - 1)), [loaded]);

  // Нумерація — за тим, що вже пройдено, а не за розміром сторінки: сервіс,
  // який фільтрує після читання, віддає коротку сторінку з курсором, і
  // «номер × розмір» показав би чужі числа.
  const before = src.pages.slice(0, current - 1).reduce((n, page) => n + page.length, 0);
  const from = items.length ? before + 1 : 0;

  return {
    page: current,
    items,
    from,
    to: items.length ? from + items.length - 1 : 0,
    total,
    totalIsFloor,
    canPrev: current > 1,
    canNext: current < loaded || src.hasNextPage,
    isLoading: src.isLoading,
    isFetching: src.isFetchingNextPage,
    window: pageWindow({ loaded, hasNext: src.hasNextPage, page: current }),
    next,
    prev,
    goto,
  };
}

/** Скільки номерів показати підряд, перш ніж середину згорнути в «…». */
const WINDOW_MAX = 7;

/**
 * Номери сторінок для панелі: всі завантажені плюс та, яку відкриє курсор.
 * Довгий прохід згортається — лишаються краї й сусіди поточної.
 */
export function pageWindow({
  loaded,
  hasNext,
  page,
}: {
  loaded: number;
  hasNext: boolean;
  page: number;
}): (number | "…")[] {
  const last = Math.max(loaded, 1) + (hasNext ? 1 : 0);
  if (last <= WINDOW_MAX) return Array.from({ length: last }, (_, i) => i + 1);

  const keep = new Set([1, last, page - 1, page, page + 1]);
  const out: (number | "…")[] = [];
  for (let i = 1; i <= last; i += 1) {
    if (keep.has(i)) {
      out.push(i);
    } else if (out[out.length - 1] !== "…") {
      out.push("…");
    }
  }
  return out;
}
