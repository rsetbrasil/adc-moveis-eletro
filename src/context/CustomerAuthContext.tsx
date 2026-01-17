

'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import type { CustomerInfo, Order } from '@/lib/types';
import { supabase } from '@/lib/supabase';

interface CustomerAuthContextType {
  customer: CustomerInfo | null;
  customerOrders: Order[];
  login: (cpf: string, pass: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const CustomerAuthContext = createContext<CustomerAuthContextType | undefined>(undefined);

export const CustomerAuthProvider = ({ children }: { children: ReactNode }) => {
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    setIsLoading(true);
    try {
      const storedCustomer = localStorage.getItem('customer');
      if (storedCustomer) {
        setCustomer(JSON.parse(storedCustomer));
      }
    } catch (error) {
      console.error("Failed to read customer from localStorage", error);
      localStorage.removeItem('customer');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!customer?.cpf) {
      setCustomerOrders([]);
      return;
    }

    const fetchOrders = async () => {
      // Query orders where customer->cpf equals the logged in customer cpf
      // Note: In Supabase, we query JSONB columns using arrow syntax
      // However, standard equality check on keys might be case sensitive or specific
      // Best approach: .contains('customer', { cpf: customer.cpf }) if customer is JSONB
      // Or .eq('customer->>cpf', customer.cpf)

      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('customer->>cpf', customer.cpf) // Assuming customer is JSONB
        .order('created_at', { ascending: false }); // Sort by newest

      if (error) {
        console.error("Error fetching customer orders: ", error);
        return;
      }

      if (data) {
        // Map created_at/updated_at if needed, mostly consistent
        setCustomerOrders(data as unknown as Order[]);
      }
    };

    fetchOrders();

    // Subscribe to changes for this customer's orders
    // Filtering real-time on JSONB might be complex in Supabase depending on configuration
    // For now, simpler to refresh on ANY order change, or just fetch once + polling if critical
    // Let's stick to fetch once to avoid over-fetching.

  }, [customer]);

  const login = async (cpf: string, pass: string): Promise<boolean> => {
    const normalizedCpf = cpf.replace(/\D/g, '');

    try {
      // Query customers table directly
      const { data: customers, error } = await supabase
        .from('customers')
        .select('*')
        .eq('cpf', normalizedCpf)
        .limit(1);

      if (error) throw error;

      const foundCustomer = customers && customers.length > 0 ? customers[0] : null;

      if (!foundCustomer) {
        toast({ title: 'Falha no Login', description: 'CPF não encontrado.', variant: 'destructive' });
        return false;
      }

      if (!foundCustomer.password) {
        toast({ title: 'Falha no Login', description: 'Esta conta ainda não possui uma senha cadastrada. Ou tente logar com o método antigo se aplicável.', variant: 'destructive' });
        return false;
      }

      if (foundCustomer.password === pass) {
        const customerToStore = { ...foundCustomer };
        delete customerToStore.password;

        setCustomer(customerToStore);
        localStorage.setItem('customer', JSON.stringify(customerToStore));
        router.push('/area-cliente/minha-conta');
        toast({
          title: 'Login bem-sucedido!',
          description: `Bem-vindo(a) de volta, ${customerToStore.name.split(' ')[0]}.`,
        });
        return true;
      } else {
        toast({
          title: 'Falha no Login',
          description: 'Senha inválida.',
          variant: 'destructive',
        });
        return false;
      }

    } catch (error) {
      console.error("Error during login:", error);
      toast({ title: 'Erro de Autenticação', description: 'Não foi possível verificar suas credenciais. Tente novamente.', variant: 'destructive' });
      return false;
    }
  };

  const logout = () => {
    setCustomer(null);
    localStorage.removeItem('customer');
    router.push('/area-cliente/login');
  };

  const value = useMemo(() => ({
    customer,
    customerOrders,
    login,
    logout,
    isLoading,
    isAuthenticated: !!customer,
  }), [customer, customerOrders, isLoading]);


  return (
    <CustomerAuthContext.Provider value={value}>
      {children}
    </CustomerAuthContext.Provider>
  );
};

export const useCustomerAuth = () => {
  const context = useContext(CustomerAuthContext);
  if (context === undefined) {
    throw new Error('useCustomerAuth must be used within a CustomerAuthProvider');
  }
  return context;
};
