import type mongoose from 'mongoose';

import type { IOrder, OrderSide, OrderStatus } from '../models/Order.js';

export type OrderBookLevel = {
  price: number;
  quantity: number;
  orderCount: number;
};

export interface ExecutedTrade {
  buyOrderId: mongoose.Types.ObjectId;
  sellOrderId: mongoose.Types.ObjectId;
  pair: string;
  price: number;
  quantity: number;
}

export interface ProcessOrderResult {
  trades: ExecutedTrade[];
  order: IOrder;
}

type OrderBook = {
  bids: BinaryHeap;
  asks: BinaryHeap;
};

class BinaryHeap {
  private readonly values: IOrder[] = [];

  public constructor(private readonly comesBefore: (left: IOrder, right: IOrder) => boolean) {}

  public get size(): number {
    return this.values.length;
  }

  public peek(): IOrder | undefined {
    return this.values[0];
  }

  public peekTop(count: number): IOrder[] {
    const taken: IOrder[] = [];
    for (let index = 0; index < count; index += 1) {
      const next = this.pop();
      if (!next) {
        break;
      }
      taken.push(next);
    }

    for (const order of taken) {
      this.push(order);
    }

    return taken;
  }

  public push(order: IOrder): void {
    this.values.push(order);
    this.bubbleUp(this.values.length - 1);
  }

  public pop(): IOrder | undefined {
    if (this.values.length === 0) {
      return undefined;
    }

    const first = this.values[0];
    const last = this.values.pop();

    if (last && this.values.length > 0) {
      this.values[0] = last;
      this.bubbleDown(0);
    }

    return first;
  }

  public remove(predicate: (order: IOrder) => boolean): IOrder | undefined {
    const index = this.values.findIndex(predicate);
    if (index === -1) {
      return undefined;
    }

    const removedOrder = this.values[index];
    const last = this.values.pop();

    if (last && index < this.values.length) {
      this.values[index] = last;
      this.bubbleUp(index);
      this.bubbleDown(index);
    }

    return removedOrder;
  }

  private bubbleUp(startIndex: number): void {
    let index = startIndex;

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (!this.comesBefore(this.values[index], this.values[parentIndex])) {
        break;
      }

      this.swap(index, parentIndex);
      index = parentIndex;
    }
  }

  private bubbleDown(startIndex: number): void {
    let index = startIndex;

    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let bestIndex = index;

      if (
        leftIndex < this.values.length &&
        this.comesBefore(this.values[leftIndex], this.values[bestIndex])
      ) {
        bestIndex = leftIndex;
      }

      if (
        rightIndex < this.values.length &&
        this.comesBefore(this.values[rightIndex], this.values[bestIndex])
      ) {
        bestIndex = rightIndex;
      }

      if (bestIndex === index) {
        break;
      }

      this.swap(index, bestIndex);
      index = bestIndex;
    }
  }

  private swap(leftIndex: number, rightIndex: number): void {
    [this.values[leftIndex], this.values[rightIndex]] = [
      this.values[rightIndex],
      this.values[leftIndex],
    ];
  }
}

function orderTimestamp(order: IOrder): number {
  return order.createdAt.getTime();
}

function comparePriceTime(left: IOrder, right: IOrder, isBid: boolean): boolean {
  if (left.price !== right.price) {
    return isBid ? left.price > right.price : left.price < right.price;
  }

  return orderTimestamp(left) < orderTimestamp(right);
}

function remainingQuantity(order: IOrder): number {
  return order.quantity - order.filledQuantity;
}

function updateOrderStatus(order: IOrder): void {
  const remaining = remainingQuantity(order);

  if (remaining <= 0) {
    order.filledQuantity = order.quantity;
    order.status = 'FILLED';
  } else if (order.filledQuantity > 0) {
    order.status = 'PARTIALLY_FILLED';
  } else {
    order.status = 'OPEN';
  }
}

export class MatchingEngine {
  private readonly books = new Map<string, OrderBook>();

  public processOrder(incomingOrder: IOrder): ProcessOrderResult {
    const book = this.getOrCreateBook(incomingOrder.pair);
    const trades: ExecutedTrade[] = [];
    const oppositeHeap = incomingOrder.side === 'BUY' ? book.asks : book.bids;

    updateOrderStatus(incomingOrder);

    while (remainingQuantity(incomingOrder) > 0) {
      const restingOrder = oppositeHeap.peek();
      if (!restingOrder || !this.pricesCross(incomingOrder, restingOrder)) {
        break;
      }

      const quantity = Math.min(remainingQuantity(incomingOrder), remainingQuantity(restingOrder));
      incomingOrder.filledQuantity += quantity;
      restingOrder.filledQuantity += quantity;
      updateOrderStatus(incomingOrder);
      updateOrderStatus(restingOrder);

      trades.push({
        buyOrderId: incomingOrder.side === 'BUY' ? incomingOrder._id : restingOrder._id,
        sellOrderId: incomingOrder.side === 'SELL' ? incomingOrder._id : restingOrder._id,
        pair: incomingOrder.pair,
        price: restingOrder.price,
        quantity,
      });

      if (remainingQuantity(restingOrder) <= 0) {
        oppositeHeap.pop();
      }
    }

    if (remainingQuantity(incomingOrder) > 0) {
      const ownHeap = incomingOrder.side === 'BUY' ? book.bids : book.asks;
      ownHeap.push(incomingOrder);
    }

    return { trades, order: incomingOrder };
  }

  public getBook(pair: string): { bids: IOrder[]; asks: IOrder[] } {
    const book = this.books.get(pair);
    if (!book) {
      return { bids: [], asks: [] };
    }

    return {
      bids: this.sortedSnapshot(book.bids),
      asks: this.sortedSnapshot(book.asks),
    };
  }

  public getTopDepth(pair: string, levels = 10): {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
  } {
    const book = this.getBook(pair);
    return {
      bids: this.aggregateDepth(book.bids, levels),
      asks: this.aggregateDepth(book.asks, levels),
    };
  }

  public getHeapSnapshot(pair: string, levels = 5): {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
  } {
    const book = this.books.get(pair);
    if (!book) {
      return { bids: [], asks: [] };
    }

    return {
      bids: book.bids.peekTop(levels).map((order) => ({
        price: order.price,
        quantity: remainingQuantity(order),
        orderCount: 1,
      })),
      asks: book.asks.peekTop(levels).map((order) => ({
        price: order.price,
        quantity: remainingQuantity(order),
        orderCount: 1,
      })),
    };
  }

  public removeOrder(pair: string, orderId: mongoose.Types.ObjectId): boolean {
    const book = this.books.get(pair);
    if (!book) {
      return false;
    }

    const matchesOrder = (order: IOrder): boolean => order._id.toString() === orderId.toString();
    return Boolean(book.bids.remove(matchesOrder) ?? book.asks.remove(matchesOrder));
  }

  private getOrCreateBook(pair: string): OrderBook {
    const existingBook = this.books.get(pair);
    if (existingBook) {
      return existingBook;
    }

    const book: OrderBook = {
      bids: new BinaryHeap((left, right) => comparePriceTime(left, right, true)),
      asks: new BinaryHeap((left, right) => comparePriceTime(left, right, false)),
    };
    this.books.set(pair, book);
    return book;
  }

  private pricesCross(incomingOrder: IOrder, restingOrder: IOrder): boolean {
    return incomingOrder.side === 'BUY'
      ? incomingOrder.price >= restingOrder.price
      : incomingOrder.price <= restingOrder.price;
  }

  private sortedSnapshot(heap: BinaryHeap): IOrder[] {
    const orders: IOrder[] = [];
    const temporaryOrders: IOrder[] = [];
    let order = heap.pop();

    while (order) {
      orders.push(order);
      temporaryOrders.push(order);
      order = heap.pop();
    }

    for (const restoredOrder of temporaryOrders) {
      heap.push(restoredOrder);
    }

    return orders;
  }

  private aggregateDepth(orders: IOrder[], levels: number): OrderBookLevel[] {
    const aggregated = new Map<number, OrderBookLevel>();
    for (const order of orders) {
      const quantity = order.quantity - order.filledQuantity;
      const existing = aggregated.get(order.price);
      if (existing) {
        existing.quantity += quantity;
        existing.orderCount += 1;
      } else {
        aggregated.set(order.price, { price: order.price, quantity, orderCount: 1 });
      }
    }

    return [...aggregated.values()].slice(0, levels);
  }
}

export type { OrderSide, OrderStatus };
