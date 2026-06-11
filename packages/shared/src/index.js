export const orderStatuses = [
    "NEW",
    "ACCEPTED",
    "PREPARING",
    "ON_DELIVERY",
    "DELIVERED",
    "CANCELLED"
];
export const paymentMethods = ["CASH", "BANK_TRANSFER", "STC_PAY"];
export function formatMoney(value) {
    return `${Number(value).toFixed(2)} SAR`;
}
export function assertNever(value) {
    throw new Error(`Unexpected value: ${value}`);
}
