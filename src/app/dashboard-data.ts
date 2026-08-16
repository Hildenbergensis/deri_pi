import { useCallback, useEffect, useState } from "react";

export type OrderStatus = "aguardando" | "producao" | "atrasado" | "urgente" | "concluido";
export type Urgencia = "normal" | "alta" | "critica";
export type Etapa = "Corte" | "Bordado" | "Silk" | "Costura Externa" | "Costura Interna" | "Expedição" | "Concluído";

export interface Order {
  id: string;
  cliente: string;
  produto: string;
  quantidade: number;
  etapa: Etapa;
  urgencia: Urgencia;
  dataPrevista: string;
  diasAtraso: number;
  responsavel: string;
  status: OrderStatus;
  vendedor: string;
  unidade: string;
  valor: number;
  classificacaoUrgencia: number | null;
}

export interface SectorMetric {
  aguardando: number;
  producao: number;
  concluido: number;
  pecas: number;
  atrasados: number;
  urgentes: number;
  tempoMedio: number;
  produtividade: number | null;
  taxaPrazo: number | null;
  tendencia: number[];
}

export interface DreValues {
  faturamento: number;
  deducoes: number;
  receitaLiquida: number;
  materiaPrima: number;
  maoDeObra: number;
  aviamentos: number;
  silkBordado: number;
  frete: number;
  impostos: number;
  comissao: number;
  perdas: number;
  taxas: number;
  custoTotal: number;
  margem: number;
  margemPerc: number;
}

export interface DashboardData {
  meta: {
    source: string;
    sheet: string;
    sourceModifiedAt: string;
    syncedAt: string;
    referenceDate: string;
    reportingPeriod: string;
    stale: boolean;
    lastError: string | null;
  };
  validation: {
    rowsRead: number;
    uniqueOrders: number;
    activeOrders: number;
    completedOrders: number;
    warnings: string[];
  };
  summary: {
    pedidosProducao: number;
    pecasProducao: number;
    pedidosAtrasados: number;
    pedidosUrgentes: number;
    pedidosConcluidos: number;
    entregueNoPrazo: number | null;
    leadTimeMedio: number | null;
    valorProducao: number;
    proximosPrazo: number;
  };
  orders: Order[];
  sectorMetrics: Record<"corte" | "bordado" | "silk" | "costuraExterna" | "costuraInterna" | "expedicao", SectorMetric>;
  monthlyData: Array<{ mes: string; pedidos: number; entregas: number; atrasados: number }>;
  atrasosPorSetor: Array<{ setor: string; atrasos: number }>;
  entregasSemana: Array<{ dia: string; entregas: number; em_risco: number }>;
  facacoes: Array<{ nome: string; pedidos: number; pecas: number; atrasados: number; taxaEntrega: number; tempoMedio: number }>;
  proximasEntregas: Order[];
  dre: {
    atual: DreValues;
    anterior: DreValues;
    mensal: Array<{ mes: string; faturamento: number; custo: number; margem: number; margemPerc: number }>;
    porProduto: Array<{ nome: string; faturamento: number; margem: number; margemPerc: number }>;
  };
  alerts: Array<{ id: number; msg: string; critica: boolean; tipo: string }>;
  filters: { clientes: string[]; vendedores: string[]; unidades: string[]; produtos: string[] };
}

const emptyMetric: SectorMetric = {
  aguardando: 0, producao: 0, concluido: 0, pecas: 0, atrasados: 0,
  urgentes: 0, tempoMedio: 0, produtividade: null, taxaPrazo: null,
  tendencia: [0, 0, 0, 0, 0, 0, 0],
};
const emptyDre: DreValues = {
  faturamento: 0, deducoes: 0, receitaLiquida: 0, materiaPrima: 0,
  maoDeObra: 0, aviamentos: 0, silkBordado: 0, frete: 0, impostos: 0,
  comissao: 0, perdas: 0, taxas: 0, custoTotal: 0, margem: 0, margemPerc: 0,
};

export const EMPTY_DASHBOARD: DashboardData = {
  meta: { source: "", sheet: "MOVIMENTAÇÃO", sourceModifiedAt: "", syncedAt: "", referenceDate: "", reportingPeriod: "", stale: true, lastError: null },
  validation: { rowsRead: 0, uniqueOrders: 0, activeOrders: 0, completedOrders: 0, warnings: [] },
  summary: { pedidosProducao: 0, pecasProducao: 0, pedidosAtrasados: 0, pedidosUrgentes: 0, pedidosConcluidos: 0, entregueNoPrazo: null, leadTimeMedio: null, valorProducao: 0, proximosPrazo: 0 },
  orders: [],
  sectorMetrics: { corte: { ...emptyMetric }, bordado: { ...emptyMetric }, silk: { ...emptyMetric }, costuraExterna: { ...emptyMetric }, costuraInterna: { ...emptyMetric }, expedicao: { ...emptyMetric } },
  monthlyData: [], atrasosPorSetor: [], entregasSemana: [], facacoes: [], proximasEntregas: [],
  dre: { atual: { ...emptyDre }, anterior: { ...emptyDre }, mensal: [], porProduto: [] },
  alerts: [], filters: { clientes: [], vendedores: [], unidades: [], produtos: [] },
};

export function useDashboardData() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      const response = await fetch(force ? "/api/refresh" : "/api/dashboard", { method: force ? "POST" : "GET" });
      const payload = await response.json();
      const nextData = force ? payload.data : payload;
      if (!response.ok || nextData.error) throw new Error(nextData.meta?.lastError || nextData.error || "Falha ao carregar os dados.");
      setData(nextData as DashboardData);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao carregar os dados.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const interval = window.setInterval(() => void refresh(false), 60_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { data, error, refreshing, refresh };
}
