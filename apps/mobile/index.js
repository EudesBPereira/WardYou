// PONTO DE ENTRADA REAL DO APP -- roda antes do Expo Router.
//
// Por que este arquivo existe (nao mexer sem ler):
//
// Ate 2026-09-11 o `main` do package.json era "expo-router/entry" e os dois
// modulos de tarefa em segundo plano eram alcancados via `app/_layout.tsx`.
// `_layout.tsx` e um modulo de ROTA: o Metro so o avalia quando o Expo Router
// monta a arvore de navegacao, ou seja, dentro do primeiro render do React --
// depois da execucao do topo do bundle, e correndo com o lado nativo.
//
// Isso importava por um motivo que nao e obvio. Ao importar "expo-task-manager"
// o modulo executa, no topo do proprio arquivo:
//
//     AppRegistry.registerHeadlessTask('expo-task-manager', () => async () => {});
//
// e o TaskService nativo, ao entregar o primeiro evento de um lote, chama
// `HeadlessJsTaskContext.startTask("expo-task-manager")`. Se a chave ainda nao
// foi registrada, isso lanca `No task registered for key expo-task-manager`,
// a excecao e ENGOLIDA (`catch (Exception e) { Log.w(...) }` em TaskService.java)
// e a tarefa headless nunca comeca. O comentario do proprio Expo, no metodo
// `maybeStartHeadlessTask`, diz o que isso custa:
//
//   "Without this, JavaTimerManager pauses all timers when the Activity is
//    paused (isPaused=true && isRunningTasks=false), causing all async JS
//    operations (promises, setTimeout, etc.) to hang indefinitely."
//
// Ou seja: com a Activity em pausa, o callback da tarefa ENTRA (a parte
// sincrona roda), e o primeiro `await` nunca resolve. E exatamente o que
// medimos em campo -- tarefa nativa disparando pontualmente e zero linhas no
// banco, com bateria isenta, `netpolicy` limpo e o throttling de localizacao
// ja refutado pelo fonte do AOSP.
//
// Importar os dois modulos AQUI garante que "expo-task-manager" seja avaliado
// no topo do bundle, antes de qualquer render e antes de `onReactContextInitialized`
// -- que e quando o nativo tenta iniciar a tarefa headless.
//
// Segundo motivo, independente: o proprio `expo-task-manager` DESREGISTRA em
// definitivo qualquer tarefa cujo nome nao esteja no mapa quando o evento chega
// (`unregisterTaskAsync` no `else` do listener, em build/TaskManager.js). Com o
// registro preso a um hook, um push podia chegar antes do `defineTask` do push
// e matar a tarefa de vez. Registrar os dois juntos, no topo, fecha essa porta.
//
// Caminhos relativos de proposito: o alias `@/` depende do resolver do Metro,
// e este arquivo e carregado cedo demais para se apoiar nisso.
import "./src/services/location/tripLocationTracking";
import "./src/services/push/pushBackgroundTask";

// Só depois o router assume e monta o app normalmente.
import "expo-router/entry";
