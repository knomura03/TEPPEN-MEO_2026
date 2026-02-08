import { StoreCsvRow, StoreCsvValidationError } from '../types';

const TEMPLATE_HEADERS = [
  'store_name',
  'address',
  'phone',
  'category',
  'business_hours',
  'website',
  'note',
] as const;

const REQUIRED_HEADERS = new Set(['store_name', 'address', 'phone', 'category']);
const MAX_ROWS = 500;

export type StoreCsvParseResult = {
  rows: StoreCsvRow[];
  errors: StoreCsvValidationError[];
};

const normalizeLines = (text: string): string[] => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');
};

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
};

const toTrimmed = (value: string): string => value.trim();

export const storeCsvImportService = {
  buildTemplateCsv(): string {
    return `${TEMPLATE_HEADERS.join(',')}\n`;
  },

  validateHeadersExact(headers: string[]): StoreCsvValidationError[] {
    if (headers.length !== TEMPLATE_HEADERS.length) {
      return [
        {
          line: 1,
          column: 'header',
          code: 'HEADER_COUNT_MISMATCH',
          message: `ヘッダ列数が不正です。テンプレートを再ダウンロードして使用してください。`,
        },
      ];
    }

    const errors: StoreCsvValidationError[] = [];
    TEMPLATE_HEADERS.forEach((expected, index) => {
      if (headers[index] !== expected) {
        errors.push({
          line: 1,
          column: expected,
          code: 'HEADER_MISMATCH',
          message: `ヘッダ不一致: ${index + 1}列目は "${expected}" である必要があります。`,
        });
      }
    });
    return errors;
  },

  parseAndValidateCsv(text: string): StoreCsvParseResult {
    const errors: StoreCsvValidationError[] = [];
    const rows: StoreCsvRow[] = [];
    const lines = normalizeLines(text);

    if (lines.length === 0 || lines[0].trim().length === 0) {
      return {
        rows: [],
        errors: [
          {
            line: 1,
            column: 'header',
            code: 'EMPTY_CSV',
            message: 'CSVが空です。テンプレートを使用してください。',
          },
        ],
      };
    }

    const headerCells = parseCsvLine(lines[0]).map(toTrimmed);
    errors.push(...this.validateHeadersExact(headerCells));

    if (errors.length > 0) {
      return { rows: [], errors };
    }

    const seenKeys = new Set<string>();
    let dataRowCount = 0;

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
      const rawLine = lines[lineIndex];
      if (!rawLine || rawLine.trim().length === 0) continue;

      dataRowCount += 1;
      const lineNumber = lineIndex + 1;
      const cells = parseCsvLine(rawLine);

      if (cells.length !== TEMPLATE_HEADERS.length) {
        errors.push({
          line: lineNumber,
          column: 'row',
          code: 'COLUMN_COUNT_MISMATCH',
          message: `列数が不正です。${TEMPLATE_HEADERS.length} 列で入力してください。`,
        });
        continue;
      }

      const rawRow = TEMPLATE_HEADERS.reduce<Record<string, string>>((acc, key, idx) => {
        acc[key] = toTrimmed(cells[idx] || '');
        return acc;
      }, {});

      TEMPLATE_HEADERS.forEach((header) => {
        if (REQUIRED_HEADERS.has(header) && rawRow[header].length === 0) {
          errors.push({
            line: lineNumber,
            column: header,
            code: 'REQUIRED',
            message: `${header} は必須です。`,
          });
        }
      });

      if (rawRow.website) {
        try {
          const parsed = new URL(rawRow.website);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('invalid protocol');
          }
        } catch {
          errors.push({
            line: lineNumber,
            column: 'website',
            code: 'INVALID_URL',
            message: 'website は http:// または https:// で始まるURLで入力してください。',
          });
        }
      }

      if (rawRow.store_name && rawRow.phone) {
        const dupKey = `${rawRow.store_name.toLowerCase()}::${rawRow.phone}`;
        if (seenKeys.has(dupKey)) {
          errors.push({
            line: lineNumber,
            column: 'store_name',
            code: 'DUPLICATE_IN_CSV',
            message: '同一CSV内で store_name + phone が重複しています。',
          });
        } else {
          seenKeys.add(dupKey);
        }
      }

      rows.push({
        storeName: rawRow.store_name,
        address: rawRow.address,
        phone: rawRow.phone,
        category: rawRow.category,
        businessHours: rawRow.business_hours || undefined,
        website: rawRow.website || undefined,
        note: rawRow.note || undefined,
      });
    }

    if (dataRowCount === 0) {
      errors.push({
        line: 2,
        column: 'row',
        code: 'EMPTY_DATA',
        message: 'データ行がありません。',
      });
    }

    if (dataRowCount > MAX_ROWS) {
      errors.push({
        line: 1,
        column: 'csv',
        code: 'ROW_LIMIT',
        message: `CSVは最大 ${MAX_ROWS} 行までです。`,
      });
    }

    return {
      rows,
      errors,
    };
  },
};
