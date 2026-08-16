Crie uma plataforma web moderna de **Production Intelligence (PI) / Business Intelligence industrial** para a **DE RI Confecções**, fabricante de uniformes personalizados.

O sistema será usado pela diretoria e gestores para acompanhar produção, pedidos, atrasos, gargalos, produtividade, custos e resultados.

## DESIGN
Interface desktop moderna, premium e clean, estilo SaaS/ERP industrial. Fundo claro, cards com cantos arredondados, sombras discretas, tipografia profissional, ícones minimalistas, gráficos modernos e excelente hierarquia visual. Evite aparência de planilha Excel.

Cores de status:
- Verde: concluído/dentro do prazo
- Amarelo: atenção
- Laranja: próximo do prazo
- Vermelho: atrasado/crítico
- Cinza: aguardando

Use cores apenas para destacar informações importantes.

## NAVEGAÇÃO

Criar sidebar vertical fixa à esquerda com logo **DE RI Confecções** e:

**VISÃO GERAL**
- Dashboard Geral

**PRODUÇÃO**
- Pendências
- Corte
- Bordado
- Silk
- Costura Externa
- Costura Interna
- Expedição

**RESULTADOS**
- DRE

Usar ícones em cada opção e destacar a página selecionada.

No menu superior criar os módulos principais:

**PRODUÇÃO | FINANCEIRO | COMPRAS**

Produção será o módulo inicialmente desenvolvido. Financeiro e Compras serão desenvolvidos posteriormente, mas já devem aparecer na arquitetura.

No canto direito: busca, notificações, período, usuário e configurações.

## DASHBOARD GERAL

Cards superiores:
- Pedidos em produção
- Peças em produção
- Pedidos atrasados
- Pedidos urgentes
- Pedidos concluídos
- % entregue no prazo
- Lead time médio
- Valor em produção

Mostrar comparação com período anterior.

Criar fluxo visual:

**PEDIDO → CORTE → BORDADO/SILK → COSTURA EXT. → COSTURA INT. → EXPEDIÇÃO → CONCLUÍDO**

Cada etapa deve mostrar pedidos, peças, atrasados, urgentes e tempo médio. Facilitar identificação imediata de gargalos.

Adicionar gráficos de evolução da produção, atrasos por setor, pedidos por etapa e entregas previstas.

## PENDÊNCIAS

Cards: total de pendências, críticas, atrasadas, próximas do prazo e peças envolvidas.

Tabela com:
Ficha/Pedido, Cliente, Produto, Quantidade, Etapa Atual, Urgência, Data Prevista, Dias de Atraso, Responsável e Status.

Filtros: período, cliente, vendedor, etapa, urgência, unidade e status.

## RELATÓRIOS DOS SETORES

Criar telas individuais para:

**CORTE**
Pedidos aguardando, em produção e concluídos; peças; atrasos; urgências; tempo médio e produtividade.

**BORDADO**
Aguardando, em produção, concluídos, peças, atrasados, urgentes, prazo médio e produtividade.

**SILK**
Aguardando, em produção, concluídos, peças, atrasados, urgentes, tempo médio e produtividade.

**COSTURA EXTERNA**
Pedidos e peças enviados, aguardando retorno, atrasados, urgentes e prazo médio. Incluir desempenho por fornecedor/facção.

**COSTURA INTERNA**
Fila, em produção, peças, concluídos, atrasados, urgentes, produtividade e tempo médio.

**EXPEDIÇÃO**
Aguardando, prontos, expedidos, peças, atrasados e entregas previstas. Criar área **Próximas Entregas**, ordenada cronologicamente e destacando pedidos críticos.

Todas as telas devem possuir cards de KPIs, gráficos, filtros e tabela operacional detalhada.

## DRE

Dashboard executivo mostrando:
- Faturamento
- Receita líquida
- Matéria-prima
- Mão de obra
- Aviamentos
- Silk/Bordado
- Frete
- Impostos
- Comissão
- Perdas
- Taxas
- Custos totais
- Margem de contribuição
- Margem %

Criar gráfico **Receita → Custos → Margem**, evolução mensal e comparativo mês atual x anterior x acumulado do ano.

Permitir análise de margem por cliente, produto e vendedor.

## ALERTAS INTELIGENTES

Criar painel **Alertas da Produção**, mostrando automaticamente situações como:

“12 pedidos atrasados na Costura Externa.”
“Pedido #4587 está 4 dias atrasado.”
“27 pedidos possuem entrega nos próximos 3 dias.”
“Costura Externa concentra 38% dos atrasos.”
“Margem do pedido #4521 abaixo do esperado.”

Classificar alertas por criticidade.

## FILTROS GLOBAIS

Hoje | Semana | Mês | Personalizado

Cliente | Vendedor | Unidade | Produto | Status | Etapa

## OBJETIVO

O diretor deve conseguir identificar em poucos segundos:
- volume atual de produção;
- gargalos;
- pedidos atrasados;
- pedidos com risco de atraso;
- urgências;
- carga de cada setor;
- próximas entregas;
- produtividade;
- faturamento e margem.

O resultado deve parecer um verdadeiro **software profissional de Production Intelligence / Manufacturing Analytics / ERP Industrial**, visualmente sofisticado e orientado à tomada de decisão.

Crie as telas:
**Dashboard Geral, Pendências, Corte, Bordado, Silk, Costura Externa, Costura Interna, Expedição e DRE.**
