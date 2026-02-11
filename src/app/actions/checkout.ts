'use server';

import { db } from '@/lib/db';
import { CustomerInfo, Order } from '@/lib/types';

export type FindCustomerResult =
    | { success: true; data: CustomerInfo; source: 'active' | 'trash' }
    | { success: true; data: null; source?: never }
    | { success: false; error: string; data?: never; source?: never };

export async function findCustomerByCpfAction(cpf: string): Promise<FindCustomerResult> {
    try {
        const customer = await db.customer.findUnique({
            where: { cpf }
        });
        if (customer) return { success: true, data: customer as unknown as CustomerInfo, source: 'active' };

        // Assuming CustomerTrash model is defined as 'customerTrash' via map "customers_trash"
        const trash = await db.customerTrash.findFirst({
            where: { cpf }
        });

        if (trash) return { success: true, data: trash.data as unknown as CustomerInfo, source: 'trash' };

        return { success: true, data: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function allocateNextCustomerCodeAction(): Promise<{ success: true; code: string }> {
    return { success: true, code: `CLI-${Date.now().toString().slice(-6)}` };
}

export type CreateOrderResult =
    | { success: true; orderId: string; error?: never }
    | { success: false; error: string; orderId?: never };

export async function createOrderAction(orderData: any, customerData: any): Promise<CreateOrderResult> {
    try {
        // @ts-ignore
        const result = await db.$transaction(async (tx) => {
            // 1. Check stock and deduct for catalog products only
            for (const item of orderData.items) {
                // Skip custom products
                if (item.id.startsWith('CUSTOM-')) {
                    continue;
                }

                // @ts-ignore
                const product = await tx.product.findUnique({
                    where: { id: item.id }
                });

                if (!product) throw new Error(`Produto ${item.name} não encontrado.`);
                if ((product.stock || 0) < item.quantity) {
                    throw new Error(`Estoque insuficiente para ${item.name}.`);
                }

                // 2. Deduct stock
                // @ts-ignore
                await tx.product.update({
                    where: { id: item.id },
                    data: { stock: (product.stock || 0) - item.quantity }
                });
            }

            // 3. Save Order
            const { firstDueDate, ...orderToSave } = orderData;
            // @ts-ignore
            await tx.order.create({
                data: orderToSave
            });

            // 4. Upsert Customer
            // @ts-ignore
            await tx.customer.upsert({
                where: { id: customerData.id },
                update: customerData,
                create: customerData
            });

            return { success: true, orderId: orderData.id };
        });

        return result as CreateOrderResult;

    } catch (error: any) {
        console.error('Order creation failed:', error);
        return { success: false, error: error.message || 'Erro desconhecido ao criar pedido.' };
    }
}
