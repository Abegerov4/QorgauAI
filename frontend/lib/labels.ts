export const TOPIC_LABELS: Record<string, string> = {
  position: "Должность",
  start_date: "Дата начала работы",
  term: "Срок договора",
  probation: "Испытательный срок",
  working_hours: "Рабочее время",
  rest_time: "Время отдыха",
  wage_amount: "Размер зарплаты",
  wage_payment: "Выплата зарплаты",
  vacation_days: "Отпуск",
  overtime_pay: "Сверхурочная работа",
  duties: "Обязанности",
  confidentiality: "Конфиденциальность",
  liability: "Ответственность",
  termination: "Расторжение",
  other: "Другое",
};

export const PII_LABELS: Record<string, string> = {
  IIN: "ИИН",
  PHONE: "телефон",
  EMAIL: "e-mail",
  IBAN: "IBAN",
  CARD: "номер карты",
  SECRET: "ключ доступа",
};

export const DOC_TYPE_LABELS: Record<string, string> = {
  employment_contract: "Трудовой договор",
  claim_statement: "Заявление",
  notice: "Уведомление",
  other: "Документ",
};

export const NODE_LABELS: Record<string, string> = {
  guard_input: "Защита",
  research: "Поиск норм",
  generate: "Ответ",
  verify: "Проверка",
  rewrite_query: "Повторный поиск",
  finalize: "Итог",
};

/** Russian plural form: plural(3, "статья", "статьи", "статей") -> "статьи". */
export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
