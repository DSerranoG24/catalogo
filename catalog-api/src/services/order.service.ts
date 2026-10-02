import { OrderStatus } from "@prisma/client";
import {
  changeOrderStatus,
  createPublicOrder,
  findOrderByIdForOwner,
  findOrdersByCatalog,
} from "../repositories/order.repository";

export { createPublicOrder };

export async function getOrdersForCatalog(catalogId: string, userId: string) {
  return findOrdersByCatalog(catalogId, userId);
}

const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};

export async function updateOrderStatus(id: string, userId: string, status: OrderStatus) {
  const order = await findOrderByIdForOwner(id, userId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (!allowedTransitions[order.status].includes(status)) {
    throw new Error("INVALID_ORDER_TRANSITION");
  }

  const result = await changeOrderStatus(id, userId, order.status, status);
  if (result.count === 0) throw new Error("ORDER_CHANGED_CONCURRENTLY");
}
