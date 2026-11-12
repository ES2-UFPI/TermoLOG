import type { Tom } from './painel';

// Vidro discreto: fundo quase liso, painéis translúcidos e uma cor quente reservada para o alerta.
// O único brilho do fundo fica atrás da sala fora da faixa e some quando tudo está ok.
export const temas = {
  escuro: {
    fundo: '#121417',
    vidro: 'rgba(255,255,255,0.035)',
    vidroForte: 'rgba(255,255,255,0.06)',
    borda: 'rgba(255,255,255,0.1)',
    texto: '#f1f2f0',
    texto2: 'rgba(241,242,240,0.62)',
    trilho: 'rgba(255,255,255,0.1)',
    faixa: ['#6fb6ff', '#8fe3c8'],
    // Uma cor por sensor nos gráficos, conferida para daltonismo. Sem o tom do alerta.
    series: ['#3987e5', '#c98500', '#199e70', '#9085e9', '#d55181'],
    folga: '#8fe3c8',
    marca: '#ffffff',
    alerta: '#ff8a73',
    alertaFundo: 'rgba(255,138,115,0.1)',
    brilho: 'rgba(255,120,95,0.16)',
    // Fundo da faixa e do aviso que flutuam sobre a tela, e a cor da sombra deles.
    flutuante: 'rgba(24,27,31,0.9)',
    sombra: '#000000',
  },
  claro: {
    fundo: '#eceef1',
    vidro: 'rgba(255,255,255,0.72)',
    vidroForte: 'rgba(23,26,31,0.04)',
    borda: 'rgba(23,26,31,0.07)',
    texto: '#171a1f',
    texto2: 'rgba(23,26,31,0.6)',
    trilho: 'rgba(23,26,31,0.08)',
    faixa: ['#3b82f6', '#14b8a6'],
    series: ['#2a78d6', '#eda100', '#1baf7a', '#6250d6', '#e87ba4'],
    folga: '#0f766e',
    marca: '#171a1f',
    alerta: '#d6452c',
    alertaFundo: 'rgba(214,69,44,0.08)',
    brilho: 'rgba(232,93,64,0.2)',
    // Fundo da faixa e do aviso que flutuam sobre a tela, e a cor da sombra deles.
    flutuante: 'rgba(246,247,249,0.94)',
    sombra: '#000000',
  },
};

export type Tema = (typeof temas)['escuro'];

/** Cor de cada situação da sala: dentro da faixa, fora da faixa, sem leitura e neutra. */
export const corDoTom = (tema: Tema, tom: Tom) =>
  ({ ok: tema.folga, alerta: tema.alerta, 'sem-leitura': tema.texto2, neutro: tema.texto2 })[tom];
