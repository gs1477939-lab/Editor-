// A constante da duração do corte (60 segundos)
const SEGMENTO_TEMPO = 60;

// URL do Core multi-thread (mt) versão 0.12.7
const CORE_VERSION = '0.12.7';
const UTIL_VERSION = '0.12.1';
const CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core-mt@${CORE_VERSION}/dist`;
const CORE_JS_URL = `${CORE_BASE_URL}/ffmpeg-core.js`;

// As classes FFmpeg e toBlobURL vêm do index.html
const ffmpeg = new window.FFmpeg();

// Referências dos elementos do HTML
const inputElement = document.getElementById('video-input');
const cutButton = document.getElementById('cut-button');
const progressArea = document.getElementById('progress-area');
const statusMessage = document.getElementById('status-message');
const progressBar = document.getElementById('progress-bar');
const downloadArea = document.getElementById('download-area');
const clipList = document.getElementById('clip-list');
const errorArea = document.getElementById('error-area');
const errorMessage = document.getElementById('error-message');


/**
 * Funções de UI
 */
function updateUI(status, message, progress = 0) {
    statusMessage.textContent = message;
    progressBar.value = progress;
    
    // Esconde todas as áreas de status por padrão
    progressArea.classList.add('hidden');
    downloadArea.classList.add('hidden');
    errorArea.classList.add('hidden');
    
    if (status === 'loading' || status === 'ready') {
        progressArea.classList.remove('hidden');
    } else if (status === 'error') {
        errorArea.classList.remove('hidden');
        errorMessage.textContent = message;
    } else if (status === 'done') {
        downloadArea.classList.remove('hidden');
    }
}

/**
 * 1. Inicializa o FFmpeg.wasm
 */
async function loadFFmpeg() {
    updateUI('loading', 'Iniciando carregamento do FFmpeg.wasm...');
    
    // Configura o log para ver o que o FFmpeg está fazendo no console
    ffmpeg.on('log', ({ message }) => {
        console.log(`[FFmpeg LOG] ${message}`);
    });
    
    // Configura a barra de progresso durante a segmentação
    ffmpeg.on('progress', ({ job, progress }) => {
        // A segmentação ocorre em uma única execução exec(), então o progresso é direto.
        const percent = Math.floor(progress * 100);
        updateUI('loading', `Processando corte de 60s: ${percent}%`, percent);
    });

    try {
        // Cria as URLs de Blob para o Worker e o WASM Core
        const coreURL = await window.toBlobURL(CORE_JS_URL, 'text/javascript');
        const wasmURL = await window.toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm');
        const workerURL = await window.toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.worker.js`, 'text/javascript');
        
        console.log("URLs de Blob criadas. Iniciando ffmpeg.load()...");

        await ffmpeg.load({
            coreURL: coreURL,
            wasmURL: wasmURL,
            workerURL: workerURL,
        });
        
        // Se chegou aqui, deu certo!
        cutButton.disabled = false;
        updateUI('ready', 'Pronto! Selecione o vídeo e clique em "Iniciar Corte".', 100);
        console.log("FFmpeg carregado com sucesso.");
        
    } catch (e) {
        console.error("ERRO CRÍTICO NO LOAD:", e);
        // Desativa o botão em caso de falha
        cutButton.disabled = true; 
        updateUI('error', 
            `Falha ao carregar o motor de corte. Motivo: ${e.message}.
            Verifique o console (F12) por erros de "SharedArrayBuffer" ou "Cross-Origin". 
            Seu navegador pode estar bloqueando a segurança, ou o GitHub Pages precisa das metatags COOP/COEP.`
        );
    }
}

/**
 * Função auxiliar para obter a duração do vídeo via API nativa do navegador
 */
function getVideoDuration(file) {
    return new Promise((resolve, reject) => {
        const videoElement = document.createElement('video');
        videoElement.preload = 'metadata';
        
        videoElement.onloadedmetadata = function() {
            window.URL.revokeObjectURL(videoElement.src);
            resolve(videoElement.duration);
        };
        
        videoElement.onerror = function() {
            reject(new Error("Não foi possível ler a duração do vídeo."));
        };

        videoElement.src = URL.createObjectURL(file);
    });
}


/**
 * 3. A Função de Corte Principal
 */
async function cutVideo() {
    const file = inputElement.files[0];
    if (!file) return;

    try {
        clipList.innerHTML = '';
        updateUI('loading', 'Lendo a duração do vídeo...');
        cutButton.disabled = true;
        
        const duration = await getVideoDuration(file);
        
        // --- 1. Calcular os comandos de corte ---
        const numClipes = Math.ceil(duration / SEGMENTO_TEMPO);
        const segmentTimes = [];
        
        // Gera a lista de tempos para o comando -segment_times (60, 120, 180...)
        for (let i = 0; i < numClipes - 1; i++) {
            segmentTimes.push(Math.round((i + 1) * SEGMENTO_TEMPO));
        }
        
        const segmentListString = segmentTimes.join(',');
        const outputFilename = 'clipe_%03d.mp4'; 
        
        const command = [
            '-i', 'input.mp4',
            '-c', 'copy', // Otimização: corte ultra-rápido sem reencodar
            '-map', '0', 
            '-f', 'segment',
            '-segment_times', segmentListString,
            '-reset_timestamps', '1',
            outputFilename
        ];
        
        console.log("Comando de corte FFmpeg:", command.join(' '));


        // --- 2. Escrever o arquivo na memória do FFmpeg (FS) ---
        updateUI('loading', `Carregando vídeo de ${(file.size / (1024 * 1024)).toFixed(2)} MB para a memória virtual...`);
        const data = new Uint8Array(await file.arrayBuffer());
        await ffmpeg.writeFile('input.mp4', data);


        // --- 3. Executar o corte ---
        updateUI('loading', `Iniciando corte de ${numClipes} clipes...`);
        await ffmpeg.exec(command);
        
        
        // --- 4. Ler e disponibilizar os arquivos de saída ---
        for (let i = 0; i < numClipes; i++) {
            const clipName = `clipe_${String(i + 1).padStart(3, '0')}.mp4`;
            
            // Tenta ler o arquivo de saída
            const clipData = await ffmpeg.readFile(clipName);
            
            // Cria o link de download
            const blob = new Blob([clipData], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = `cortado_${SEGMENTO_TEMPO}s_${clipName}`;
            link.textContent = `⬇️ Baixar ${clipName}`;
            link.classList.add('download-link');
            clipList.appendChild(link);
        }
        
        updateUI('done');
        
    } catch (e) {
        console.error("ERRO durante o processo de corte:", e);
        updateUI('error', `Erro ao processar o vídeo. Detalhe: ${e.message}`);
    } finally {
        cutButton.disabled = false;
        // Limpar o arquivo de entrada da memória virtual
        await ffmpeg.deleteFile('input.mp4').catch(e => console.warn("Não foi possível remover o arquivo de entrada: ", e));
    }
}

// 4. Listeners (Eventos)
inputElement.addEventListener('change', () => {
    // Habilita o botão *somente se* o FFmpeg já estiver pronto (disabled=false) E houver um arquivo.
    if (!cutButton.disabled) { 
        cutButton.disabled = !inputElement.files.length;
    }
    downloadArea.classList.add('hidden');
    errorArea.classList.add('hidden');
});

cutButton.addEventListener('click', cutVideo);

// Inicia o carregamento do FFmpeg (É o primeiro a rodar!)
loadFFmpeg();

          
