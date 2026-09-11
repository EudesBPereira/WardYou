import { Platform } from "react-native";
import * as Location from "expo-location";
import * as Network from "expo-network";
import * as AppBlock from "@modules/app-block";
import { getPushPermissionStatus } from "@/services/push/pushService";

/**
 * Diagnostico de protecao do aparelho.
 *
 * Existe porque o app tinha o habito de **afirmar uma protecao sem verificar se
 * ela esta disponivel**: o Modo Guarda aparecia ligado sem o sensor rodando, o
 * push dizia "ok" sem credencial, a tela de limites funcionava com a
 * acessibilidade desligada. Este modulo inverte isso — mede primeiro, e o que
 * nao estiver de pe vira um aviso com o caminho para resolver.
 *
 * O GPS e o caso mais importante e o que mais faltava: a permissao pode estar
 * concedida e a localizacao do aparelho **desligada no sistema**, e ai nada
 * funciona sem que nada avise.
 */

export type NivelProtecao = "completa" | "limitada" | "acao" | "offline";

export type IdProblema =
  | "accessibility"
  | "usageAccess"
  | "locationPermission"
  | "locationServices"
  | "battery"
  | "overlay"
  | "deviceAdmin"
  | "push"
  | "network";

export interface Problema {
  id: IdProblema;
  /** `critica` derruba a funcao inteira; `degrada` deixa funcionar pior. */
  severidade: "critica" | "degrada";
  /** Abre a tela de sistema que resolve. Ausente quando nao ha para onde levar. */
  resolver?: () => void;
}

export interface Diagnostico {
  nivel: NivelProtecao;
  problemas: Problema[];
  /** Xiaomi/Huawei/Oppo/Vivo: matam servico em segundo plano por conta propria. */
  oemAgressiva: boolean;
}

/** Ordem importa: e a ordem em que aparecem para o usuario resolver. */
export async function diagnosticar(modoCrianca: boolean): Promise<Diagnostico> {
  const problemas: Problema[] = [];
  const android = Platform.OS === "android";

  const online = await temRede();
  if (!online) {
    // Sem rede nao da para concluir mais nada com confianca — e o proprio
    // estado ja explica tudo que o usuario precisa saber agora.
    return { nivel: "offline", problemas: [{ id: "network", severidade: "critica" }], oemAgressiva: false };
  }

  // --- Localizacao: os dois lados. Permissao concedida com GPS desligado e o
  // caso silencioso que ninguem percebe.
  const [permissao, servicosLigados] = await Promise.all([
    nivelPermissaoLocalizacao(),
    servicosLocalizacaoLigados(),
  ]);
  if (permissao === "denied") {
    problemas.push({ id: "locationPermission", severidade: "critica", resolver: abrirAjustesDoApp });
  }
  if (!servicosLigados) {
    problemas.push({ id: "locationServices", severidade: "critica", resolver: abrirAjustesLocalizacao });
  }

  if (android) {
    // --- Enforcement (so faz sentido cobrar no aparelho da crianca)
    if (modoCrianca) {
      if (!AppBlock.isAccessibilityServiceEnabled()) {
        problemas.push({ id: "accessibility", severidade: "critica", resolver: AppBlock.openAccessibilitySettings });
      }
      if (!AppBlock.hasUsageAccess()) {
        problemas.push({ id: "usageAccess", severidade: "critica", resolver: AppBlock.openUsageAccessSettings });
      }
      if (!AppBlock.isDeviceAdminActive()) {
        problemas.push({ id: "deviceAdmin", severidade: "degrada", resolver: AppBlock.requestDeviceAdmin });
      }
    }
    // --- Sobrevivencia em segundo plano (vale para qualquer perfil)
    if (!AppBlock.isIgnoringBatteryOptimizations()) {
      problemas.push({ id: "battery", severidade: "degrada", resolver: AppBlock.requestIgnoreBatteryOptimizations });
    }
    if (modoCrianca && !AppBlock.canDrawOverlays()) {
      problemas.push({ id: "overlay", severidade: "degrada", resolver: AppBlock.requestOverlayPermission });
    }
  }

  // --- Push: sem isso SOS, alerta de zona e pedido de liberacao nao chegam.
  const push = await getPushPermissionStatus();
  if (push === "denied") {
    problemas.push({ id: "push", severidade: "critica", resolver: abrirAjustesDoApp });
  }

  return {
    nivel: calcularNivel(problemas),
    problemas,
    oemAgressiva: android ? AppBlock.isAggressiveOem() : false,
  };
}

function calcularNivel(problemas: Problema[]): NivelProtecao {
  if (problemas.some((p) => p.id === "network")) return "offline";
  if (problemas.some((p) => p.severidade === "critica")) return "acao";
  if (problemas.length > 0) return "limitada";
  return "completa";
}

async function temRede(): Promise<boolean> {
  try {
    const s = await Network.getNetworkStateAsync();
    return !!s.isConnected && s.isInternetReachable !== false;
  } catch {
    // Na duvida, assume online: um falso "offline" esconderia os outros avisos.
    return true;
  }
}

async function nivelPermissaoLocalizacao(): Promise<"always" | "whenInUse" | "denied"> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) return "denied";
    if (Platform.OS !== "android") return "always";
    const bg = await Location.getBackgroundPermissionsAsync();
    return bg.granted ? "always" : "whenInUse";
  } catch {
    return "denied";
  }
}

/** O GPS/localizacao do SISTEMA esta ligado? Independe de permissao do app. */
async function servicosLocalizacaoLigados(): Promise<boolean> {
  try {
    return await Location.hasServicesEnabledAsync();
  } catch {
    return true;
  }
}

function abrirAjustesLocalizacao(): void {
  if (Platform.OS === "android") {
    AppBlock.openLocationSettings();
    return;
  }
  abrirAjustesDoApp();
}

function abrirAjustesDoApp(): void {
  if (Platform.OS === "android") {
    AppBlock.openAppSettings();
    return;
  }
  void import("expo-linking").then((L) => L.openSettings());
}
