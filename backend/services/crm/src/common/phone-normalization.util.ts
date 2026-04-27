import { BadRequestException } from '@nestjs/common';

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (digits.length < 10) {
    throw new BadRequestException(`Invalid phone number: ${phone}`);
  }

  let normalized: string;

  if (digits.length === 10) {
    normalized = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    normalized = `+${digits}`;
  } else if (digits.length >= 11 && digits.length <= 15) {
    normalized = `+${digits}`;
  } else {
    throw new BadRequestException(`Invalid phone number: ${phone}`);
  }

  return normalized;
}

export function normalizePhones(phones: string[]): string[] {
  return phones.map(normalizePhone);
}

export function formatPhoneDisplay(normalized: string): string {
  const digits = normalized.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    const area = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line = digits.slice(7, 11);
    return `(${area}) ${prefix}-${line}`;
  }
  return normalized;
}
