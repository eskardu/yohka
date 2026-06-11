const deliveryWeekdays = [2, 4, 6];

export function getNextDeliveryDays(count = 3, from = new Date()) {
  const days: string[] = [];
  const cursor = new Date(from);
  cursor.setHours(12, 0, 0, 0);

  while (days.length < count) {
    if (deliveryWeekdays.includes(cursor.getDay())) {
      days.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}
