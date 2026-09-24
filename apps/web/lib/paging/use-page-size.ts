"use client";

import { useCallback, useState } from "react";

/**
 * По скільки рядків вантажити. Стеля — 200: стільки приймає `limit` у
 * списках сервісів, і стільки ще влазить у відповідь DynamoDB на один запит.
 */
export const PAGE_SIZES = [25, 50, 100, 200] as const;

export const DEFAULT_PAGE_SIZE = 50;

const key = (list: string) => `bitcrm.page-size.${list}`;

function stored(list: string): number | null {
  try {
    const raw = Number(localStorage.getItem(key(list)));
    return (PAGE_SIZES as readonly number[]).includes(raw) ? raw : null;
  } catch {
    // Приватне вікно або заблоковані дані сайту — вибір просто не переживе
    // перезавантаження, але список має працювати.
    return null;
  }
}

/**
 * Вибір «по скільки» для одного списку, з пам'яттю між візитами. Ключ — назва
 * списку: у роботах і в дзвінках вибір свій.
 */
export function usePageSize(list: string): [number, (size: number) => void] {
  const [size, setSize] = useState(() => stored(list) ?? DEFAULT_PAGE_SIZE);

  const choose = useCallback(
    (next: number) => {
      setSize(next);
      try {
        localStorage.setItem(key(list), String(next));
      } catch {
        // Те саме: без пам'яті, але з вибором.
      }
    },
    [list],
  );

  return [size, choose];
}
