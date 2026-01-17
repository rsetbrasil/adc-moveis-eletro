'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getClientFirebase } from '@/lib/firebase-client';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { createClient } from '@supabase/supabase-js';
import { Loader2, CheckCircle2, AlertCircle, Database } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

// Collections to migrate and their Supabase table equivalent
const MAPPINGS = [
    { collection: 'users', table: 'users' },
    { collection: 'products', table: 'products' },
    { collection: 'categories', table: 'categories' },
    { collection: 'customers', table: 'customers' },
    { collection: 'customersTrash', table: 'customers_trash' },
    { collection: 'orders', table: 'orders' },
    { collection: 'commissionPayments', table: 'commission_payments' },
    { collection: 'stockAudits', table: 'stock_audits' },
    { collection: 'avarias', table: 'avarias' },
    { collection: 'chatSessions', table: 'chat_sessions' },
    { collection: 'auditLogs', table: 'audit_logs' },
    { collection: 'config', table: 'config' },
];

export default function MigratePage() {
    const { user } = useAuth();
    const { toast } = useToast();

    const [supabaseUrl, setSupabaseUrl] = useState('');
    const [supabaseKey, setSupabaseKey] = useState('');

    const [isMigrating, setIsMigrating] = useState(false);
    const [progress, setProgress] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    if (!user || user.role !== 'admin') {
        return (
            <div className="container mx-auto p-8 text-center">
                <h1 className="text-2xl font-bold text-destructive">Acesso Negado</h1>
                <p>Apenas administradores podem acessar esta ferramenta.</p>
            </div>
        );
    }

    // Helper to convert Firestore dates to ISO strings for Postgres
    const transformData = (data: any): any => {
        if (!data) return data;

        if (data instanceof Timestamp) {
            return data.toDate().toISOString();
        }

        if (Array.isArray(data)) {
            return data.map(item => transformData(item));
        }

        if (typeof data === 'object') {
            const transformed: any = {};
            for (const key in data) {
                transformed[key] = transformData(data[key]);
            }
            return transformed;
        }

        return data;
    };

    const handleMigrate = async () => {
        if (!supabaseUrl || !supabaseKey) {
            toast({ title: "Erro", description: "Preencha a URL e a Key do Supabase.", variant: "destructive" });
            return;
        }

        setIsMigrating(true);
        setError(null);
        setProgress([]);

        try {
            // 1. Initialize Source DB (Firebase)
            const { db: sourceDb } = getClientFirebase();

            // 2. Initialize Target DB (Supabase)
            const supabase = createClient(supabaseUrl, supabaseKey);

            // 3. Migrate Collections
            for (const { collection: collectionName, table } of MAPPINGS) {
                addLog(`Iniciando migração: ${collectionName} -> ${table}...`);

                // Read from Source
                const snapshot = await getDocs(collection(sourceDb, collectionName));
                const docs = snapshot.docs;

                if (docs.length === 0) {
                    addLog(`Coleção ${collectionName} vazia. Pulando.`);
                    continue;
                }

                addLog(`- Lendo ${docs.length} documentos de ${collectionName}...`);

                // Transform and Insert in Batches
                const BATCH_SIZE = 100;
                const chunks = [];

                // Prepare all data first
                const allRows = docs.map(d => {
                    const rawData = d.data();
                    const transformed = transformData(rawData);

                    // Special handling for 'config' table which is Key-Value (key, value)
                    if (collectionName === 'config') {
                        return {
                            key: d.id,
                            value: transformed
                        };
                    }

                    // Map specific fields that differ between Firestore (Types) and Supabase (SQL)
                    // SQL Schema uses `created_at` but Types use `createdAt`
                    if (transformed.createdAt) {
                        transformed.created_at = transformed.createdAt;
                        delete transformed.createdAt;
                    }
                    if (transformed.updatedAt) {
                        transformed.updated_at = transformed.updatedAt;
                        delete transformed.updatedAt;
                    }

                    // Ensure ID is present
                    return {
                        id: d.id,
                        ...transformed
                    };
                });

                // Split into chunks
                for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
                    chunks.push(allRows.slice(i, i + BATCH_SIZE));
                }

                let totalWritten = 0;

                for (const chunk of chunks) {
                    const { error: insertError } = await supabase.from(table).upsert(chunk);

                    if (insertError) {
                        console.error(`Error inserting into ${table}:`, insertError);
                        throw new Error(`Erro ao salvar em ${table}: ${insertError.message}`);
                    }

                    totalWritten += chunk.length;
                    addLog(`- Salvando lote de ${chunk.length} documentos... (${totalWritten}/${allRows.length})`);
                }

                addLog(`✅ Sucesso: ${table} (${totalWritten} registros)`);
            }

            addLog('🚀 Migração para Supabase Concluída!');
            toast({ title: "Sucesso!", description: "Todos os dados foram migrados para o Supabase." });

        } catch (err: any) {
            console.error("Migration Error:", err);
            const msg = err.message || "Ocorreu um erro desconhecido durante a migração.";
            setError(msg);
            addLog(`❌ ERRO: ${msg}`);
            toast({ title: "Erro na Migração", description: msg, variant: "destructive" });
        } finally {
            setIsMigrating(false);
        }
    };

    const addLog = (msg: string) => {
        setProgress(prev => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);
    };

    return (
        <div className="container mx-auto p-6 max-w-4xl">
            <div className="mb-6">
                <h1 className="text-3xl font-bold flex items-center gap-2 text-green-600">
                    <Database className="w-8 h-8" />
                    Migração para Supabase
                </h1>
                <p className="text-muted-foreground mt-2">
                    Ferramenta para copiar dados do Firebase para o Supabase.
                    Certifique-se de ter criado as tabelas no Supabase antes de iniciar.
                </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Configuração do Supabase</CardTitle>
                        <CardDescription>Cole as credenciais do seu projeto Supabase</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid w-full items-center gap-1.5">
                            <Label htmlFor="url">Project URL</Label>
                            <Input id="url" value={supabaseUrl} onChange={e => setSupabaseUrl(e.target.value)} placeholder="https://example.supabase.co" />
                        </div>
                        <div className="grid w-full items-center gap-1.5">
                            <Label htmlFor="key">API Key (service_role ou anon)</Label>
                            <Input id="key" value={supabaseKey} onChange={e => setSupabaseKey(e.target.value)} placeholder="public-anon-key" />
                            <p className="text-xs text-muted-foreground">Recomendado usar 'service_role' para contornar RLS durante a migração.</p>
                        </div>

                        <Button
                            className="w-full mt-4 bg-green-600 hover:bg-green-700"
                            onClick={handleMigrate}
                            disabled={isMigrating || !supabaseUrl || !supabaseKey}
                        >
                            {isMigrating ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Migrando...
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 className="mr-2 h-4 w-4" />
                                    Iniciar Migração
                                </>
                            )}
                        </Button>
                    </CardContent>
                </Card>

                <Card className="h-full flex flex-col">
                    <CardHeader>
                        <CardTitle>Progresso</CardTitle>
                        <CardDescription>Log de operações em tempo real</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 bg-black/5 rounded-md mx-6 mb-6 p-4 font-mono text-xs overflow-y-auto max-h-[500px] border">
                        {progress.length === 0 ? (
                            <span className="text-muted-foreground italic">Aguardando início...</span>
                        ) : (
                            progress.map((log, index) => (
                                <div key={index} className="mb-1 border-b border-black/5 pb-1 last:border-0">
                                    {log}
                                </div>
                            ))
                        )}
                        {error && (
                            <div className="mt-4 p-2 bg-destructive/10 text-destructive border border-destructive/20 rounded">
                                <AlertCircle className="inline w-4 h-4 mr-1" />
                                {error}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
