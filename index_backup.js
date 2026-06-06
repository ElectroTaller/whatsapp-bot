require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Inicialización de Google Gemini si la clave está configurada
const apiKeyValida = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'tu_api_key_aqui';
const geminiModelName = (process.env.GEMINI_MODEL || 'gemini-1.5-flash').trim().toLowerCase().replace(/\s+/g, '-');
let genAI = null;
let chatHistories = {};

// Administradores autorizados (Soporta IDs LID o números telefónicos)
const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
const adminAire = (process.env.ADMIN_AIRE || '').split(',').map(id => id.trim()).filter(Boolean);
const adminAuto = (process.env.ADMIN_AUTO || '').split(',').map(id => id.trim()).filter(Boolean);

// Lista de palabras obscenas y groserías comunes para el filtro local de seguridad
const palabrasProhibidas = [
    'pendejo', 'pendeja', 'mierda', 'cabron', 'cabrón', 'puto', 'puta', 
    'verga', 'hijo de puta', 'hijo de perra', 'chucha', 'coño', 'culiao', 'culiado',
    'xopa', 'cueco', 'maricon', 'maricón', 'singao', 'malparido', 'vergazazo'
];

if (apiKeyValida) {
    try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        console.log(`🤖 IA de Google Gemini configurada y lista (Modelo: ${geminiModelName}).`);
    } catch (e) {
        console.error('❌ Error al inicializar Gemini:', e.message);
    }
} else {
    console.warn('⚠️ No se detectó una GEMINI_API_KEY válida en el archivo .env. El bot usará el menú interactivo como fallback.');
}

const expressApp = express();
const port = 3000;

expressApp.use(cors());
expressApp.use(express.json());

// ─────────────────────────────────────────────────────────
// DETECTAR NAVEGADOR (Chrome o Edge)
// ─────────────────────────────────────────────────────────
let browserPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if (!fs.existsSync(browserPath)) {
    browserPath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}
if (!fs.existsSync(browserPath)) {
    console.error('❌ No se encontró Chrome ni Edge. Instala uno de los dos.');
    process.exit(1);
}
console.log(`🌐 Usando navegador: ${browserPath}`);

// ─────────────────────────────────────────────────────────
// VARIABLES GLOBALES
// ─────────────────────────────────────────────────────────
let isReady1 = false;
let isReady2 = false;
let startupReady1 = false;  // true cuando el cooldown post-ready termina (línea 1)
let startupReady2 = false;  // true cuando el cooldown post-ready termina (línea 2)
let allowHumanContact = true;
let notifyAfterHours = true;
let dbOrders = [];
let userStates = {};
let humanTakenOver = {}; // Chats bajo control humano: { [clientId]: true }

// Rate Limiting por remitente
const rateLimitMap = {};        // { senderId: [timestamp1, timestamp2, ...] }
const RATE_LIMIT_MAX = 5;       // máximo mensajes permitidos
const RATE_LIMIT_WINDOW = 60000; // en ventana de 60 segundos

// API Key para proteger el endpoint /send
const API_KEY = process.env.API_KEY || 'wft-bot-2026';

let client1 = null;
let client2 = null;
let readyTimeout1 = null;
let readyTimeout2 = null;
let reconnectTimer1 = null;
let reconnectTimer2 = null;

// ─────────────────────────────────────────────────────────
// FUNCIÓN DE CREACIÓN DEL CLIENTE (parametrizada para multilínea)
// ─────────────────────────────────────────────────────────
function crearCliente(lineaNum) {
    const clientId = `wft-line-${lineaNum}`;
    
    // Destruir instancia previa si existe
    if (lineaNum === 1) {
        if (client1) { try { client1.destroy(); } catch (e) {} }
        client1 = null;
        isReady1 = false;
    } else {
        if (client2) { try { client2.destroy(); } catch (e) {} }
        client2 = null;
        isReady2 = false;
    }

    console.log(`🔄 [LÍNEA ${lineaNum}] Iniciando cliente de WhatsApp...`);

    const clientInstance = new Client({
        authStrategy: new LocalAuth({
            clientId: clientId,
            dataPath: path.join(__dirname, '.wwebjs_auth')
        }),
        puppeteer: {
            executablePath: browserPath,
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-default-apps',
                '--disable-extensions',
                '--disable-background-timer-throttling',
                '--window-size=800,600'
            ],
            timeout: 60000  // 60 segundos para abrir navegador
        }
    });

    if (lineaNum === 1) {
        client1 = clientInstance;
    } else {
        client2 = clientInstance;
    }

    // ── Eventos del ciclo de vida ──────────────────────────
    clientInstance.on('qr', (qr) => {
        if (lineaNum === 1) clearTimeout(readyTimeout1);
        else clearTimeout(readyTimeout2);

        console.log('\n----------------------------------------------------');
        console.log(`📱 ESCANEA EL QR PARA VINCULAR LA [LÍNEA ${lineaNum}] 📱`);
        console.log('----------------------------------------------------');
        qrcode.generate(qr, { small: true });
    });

    clientInstance.on('authenticated', () => {
        console.log(`✅ [LÍNEA ${lineaNum}] Autenticación exitosa. Cargando WhatsApp...`);
        
        if (lineaNum === 1) {
            clearTimeout(readyTimeout1);
            readyTimeout1 = setTimeout(() => {
                console.warn(`⏱️ [LÍNEA 1] Timeout: El bot tardó demasiado en conectarse. Reiniciando...`);
                reiniciarCliente(1);
            }, 60000);
        } else {
            clearTimeout(readyTimeout2);
            readyTimeout2 = setTimeout(() => {
                console.warn(`⏱️ [LÍNEA 2] Timeout: El bot tardó demasiado en conectarse. Reiniciando...`);
                reiniciarCliente(2);
            }, 60000);
        }
    });

    clientInstance.on('ready', () => {
        if (lineaNum === 1) {
            clearTimeout(readyTimeout1);
            isReady1 = true;
            startupReady1 = false;
            setTimeout(() => {
                startupReady1 = true;
                console.log('✅ [LÍNEA 1] Periodo de gracia finalizado. Bot procesando mensajes.');
            }, 30000);
        } else {
            clearTimeout(readyTimeout2);
            isReady2 = true;
            startupReady2 = false;
            setTimeout(() => {
                startupReady2 = true;
                console.log('✅ [LÍNEA 2] Periodo de gracia finalizado. Bot procesando mensajes.');
            }, 30000);
        }
        console.log(`✅ [LÍNEA ${lineaNum}] Conectada. Esperando 30s de gracia antes de procesar mensajes...`);
    });

    clientInstance.on('auth_failure', (msg) => {
        if (lineaNum === 1) {
            clearTimeout(readyTimeout1);
            isReady1 = false;
        } else {
            clearTimeout(readyTimeout2);
            isReady2 = false;
        }
        console.error(`❌ [LÍNEA ${lineaNum}] Fallo de autenticación:`, msg);
        console.log(`🧹 [LÍNEA ${lineaNum}] Limpiando caché de sesión y reiniciando...`);
        limpiarCache(lineaNum);
        reiniciarCliente(lineaNum, 5000);
    });

    clientInstance.on('disconnected', (reason) => {
        if (lineaNum === 1) {
            clearTimeout(readyTimeout1);
            isReady1 = false;
        } else {
            clearTimeout(readyTimeout2);
            isReady2 = false;
        }
        console.log(`⚠️ [LÍNEA ${lineaNum}] Desconectado: ${reason}. Reconectando en 10 segundos...`);
        reiniciarCliente(lineaNum, 10000);
    });

    // Registrar listeners de mensajes para esta instancia
    registrarListenerMensajes(clientInstance, `Línea ${lineaNum}`);

    clientInstance.initialize().catch(err => {
        console.error(`❌ [LÍNEA ${lineaNum}] Error al inicializar:`, err.message);
        reiniciarCliente(lineaNum, 10000);
    });
}

function limpiarCache(lineaNum) {
    const cachePath = path.join(__dirname, '.wwebjs_auth', `session-wft-line-${lineaNum}`);
    if (fs.existsSync(cachePath)) {
        try {
            fs.rmSync(cachePath, { recursive: true, force: true });
            console.log(`🧹 [LÍNEA ${lineaNum}] Caché de sesión eliminado.`);
        } catch (e) {
            console.warn(`[LÍNEA ${lineaNum}] No se pudo limpiar el caché automáticamente:`, e.message);
        }
    }
}

function reiniciarCliente(lineaNum, delay = 5000) {
    if (lineaNum === 1) {
        clearTimeout(reconnectTimer1);
        reconnectTimer1 = setTimeout(() => {
            crearCliente(1);
        }, delay);
    } else {
        clearTimeout(reconnectTimer2);
        reconnectTimer2 = setTimeout(() => {
            crearCliente(2);
        }, delay);
    }
}



// Endpoints Express (la API del bot — siempre activos, independientes del estado de WA)

// Endpoint para obtener la configuración del bot
expressApp.get('/config', (req, res) => {
    res.json({ success: true, config: { allowHumanContact, notifyAfterHours } });
});

// Endpoint para actualizar la configuración del bot
expressApp.post('/config', (req, res) => {
    if (req.body) {
        let updated = false;
        if (req.body.allowHumanContact !== undefined) {
            allowHumanContact = req.body.allowHumanContact === true || req.body.allowHumanContact === 'true';
            console.log(`⚙️ Configuración actualizada: Permitir hablar con humano = ${allowHumanContact}`);
            updated = true;
        }
        if (req.body.notifyAfterHours !== undefined) {
            notifyAfterHours = req.body.notifyAfterHours === true || req.body.notifyAfterHours === 'true';
            console.log(`⚙️ Configuración actualizada: Notificar fuera de horario = ${notifyAfterHours}`);
            updated = true;
        }
        
        if (updated) {
            res.json({ success: true, config: { allowHumanContact, notifyAfterHours } });
        } else {
            res.status(400).json({ success: false, error: 'Se requiere parámetro allowHumanContact o notifyAfterHours.' });
        }
    } else {
        res.status(400).json({ success: false, error: 'Cuerpo de solicitud inválido.' });
    }
});

// Endpoint para sincronizar órdenes desde la web
expressApp.post('/sync-orders', (req, res) => {
    if (req.body && Array.isArray(req.body.orders)) {
        dbOrders = req.body.orders;
        console.log(`📦 Órdenes sincronizadas: ${dbOrders.length} órdenes recibidas.`);
        res.json({ success: true, count: dbOrders.length });
    } else {
        res.status(400).json({ success: false, error: 'Formato inválido. Se espera { orders: [...] }' });
    }
});

// Función para normalizar texto de búsqueda de órdenes (elimina prefijos comunes, guiones y espacios)
function normalizarTextoBusqueda(txt) {
    if (!txt) return '';
    return txt.toUpperCase()
        .trim()
        // Eliminar prefijos comunes al inicio: ORDEN DE SERVICIO, ORDEN DE TRABAJO, ORDEN, ORD, NÚMERO, NUMERO, NUM, N°, N_
        .replace(/^(ORDEN DE SERVICIO|ORDEN DE TRABAJO|ORDEN|ORD|NÚMERO|NUMERO|NUM|N°|N_)+/g, '')
        // Eliminar caracteres no alfanuméricos sobrantes al inicio/fin (guiones, espacios, guiones bajos residuales)
        .replace(/^[\s\-_]+|[\s\-_]+$/g, '')
        // Eliminar guiones, espacios y guiones bajos intermedios para comparar strings compactos
        .replace(/[\s\-_]+/g, '');
}

// Función para obtener la descripción completa del equipo incluyendo marca y modelo (ej. para ECUs)
function obtenerDescripcionEquipo(order) {
    let equipo = order.deviceType || 'Equipo';
    let extras = [];
    
    if (order.vehicleData) {
        if (order.vehicleData.brand) extras.push(order.vehicleData.brand);
        if (order.vehicleData.model) extras.push(order.vehicleData.model);
    }
    
    if (order.acData) {
        if (order.acData.brand) extras.push(order.acData.brand);
        if (order.acData.model) extras.push(order.acData.model);
    }

    if (order.brand && !extras.includes(order.brand)) extras.push(order.brand);
    if (order.model && !extras.includes(order.model)) extras.push(order.model);
    
    if (extras.length > 0) {
        equipo += ` ${extras.join(' ')}`;
    }
    if (order.deviceDesc) {
        equipo += ` (${order.deviceDesc})`;
    }
    return equipo.trim();
}

// 🤖 CEREBRO DEL BOT: función que registra el listener de mensajes (se llama cada vez que el cliente se crea)
function registrarListenerMensajes(clientInstance, nombreLinea) {
    clientInstance.on('message', async msg => {
    // ── Capa -2: Ignorar mensajes propios del bot ──────────────────────────────
    if (msg.fromMe) return;

    // ── Capa -1: Verificar que el bot completó el periodo de gracia post-arranque ──
    const lineaNumMsg = clientInstance === client1 ? 1 : 2;
    const startupOk = lineaNumMsg === 1 ? startupReady1 : startupReady2;
    if (!startupOk) {
        console.log(`[${nombreLinea}] ⏳ Ignorando mensaje (periodo de gracia activo).`);
        return;
    }

    // ── Capa -0.5: Verificar antigüedad del mensaje (máx 2 minutos) ──────────
    const ahoraUnix = Math.floor(Date.now() / 1000);
    const edadSegundos = ahoraUnix - (msg.timestamp || ahoraUnix);
    if (edadSegundos > 120) {
        console.log(`[${nombreLinea}] ⏰ Ignorando mensaje viejo (${edadSegundos}s de antigüedad) de ${msg.from}`);
        return;
    }

    // ── Capa 0: Filtro de estados, broadcasts y grupos (reforzado) ──────────────
    if (msg.isStatus || msg.from === 'status@broadcast' || msg.to === 'status@broadcast' || (msg.from && msg.from.includes('status'))) {
        console.log(`[${nombreLinea}] Ignorando actualización de estado.`);
        return;
    }
    if (msg.from.includes('@g.us')) {
        return; // Ignorar mensajes de grupos
    }

    const texto = msg.body.trim().toLowerCase();
    const sender = msg.from;

    // ── Capa 0.5: Rate Limiting por remitente (máx 5 msgs/min) ──────────────────
    const ahoraMs = Date.now();
    if (!rateLimitMap[sender]) rateLimitMap[sender] = [];
    rateLimitMap[sender] = rateLimitMap[sender].filter(t => ahoraMs - t < RATE_LIMIT_WINDOW);
    if (rateLimitMap[sender].length >= RATE_LIMIT_MAX) {
        console.warn(`[${nombreLinea}] 🚫 Rate limit alcanzado para ${sender} (${rateLimitMap[sender].length} msgs en 60s)`);
        return;
    }
    rateLimitMap[sender].push(ahoraMs);

    // ── Capa 1: Filtro Local Rápido contra Lenguaje Obsceno ──────────────────────────
    const contienePalabraProhibida = palabrasProhibidas.some(p => texto.includes(p));
    if (contienePalabraProhibida) {
        console.warn(`⚠️ Mensaje ignorado debido a lenguaje obsceno detectado localmente de ${sender}`);
        return; // Salir de inmediato sin responder
    }

    // ── Capa 2: Filtro de Imágenes / Medios (Ignorar fotos, videos, documentos) ──
    if (msg.hasMedia && msg.type !== 'audio' && msg.type !== 'ptt') {
        console.log(`[${nombreLinea}] Ignorando mensaje multimedia (tipo: ${msg.type}) de ${sender}`);
        return;
    }

    // ── Comando de depuración para reiniciar el chat en caliente ────────────────────────
    if (texto === 'reiniciar' || texto === 'limpiar' || texto === 'reset' || texto === 'limpiar chat') {
        delete chatHistories[sender];
        delete userStates[sender];
        console.log(`🔄 Historial de conversación reiniciado para el número: ${sender}`);
        return msg.reply('🔄 Historial de conversación reiniciado. ¡Podemos comenzar desde cero!');
    }

    // ── Comando de depuración profunda de WhatsApp ────────────────────────────────────
    if (texto === 'debug-wa') {
        let contactNum = 'Desconocido';
        try {
            const contact = await msg.getContact();
            contactNum = contact ? contact.number : 'Sin número';
        } catch(e) {}
        
        return msg.reply(`*⚠️ DEBUG DE WHATSAPP SERVER ⚠️*\n\nWhatsApp me dice que tú eres:\n- *msg.from:* ${msg.from}\n- *msg.author:* ${msg.author || 'N/A'}\n- *contact.number:* ${contactNum}\n- *ID de Dispositivo:* ${msg.deviceType}\n\nSi ves un número extraño (como 227...), es porque WhatsApp (Meta) me está entregando ese ID oculto o tu cuenta tiene ese identificador interno en lugar de tu número telefónico normal.`);
    }

    // ── Resolver número de teléfono real del remitente (priorizando contact.number) ───
    // Helper: formatea un número como +507XXXXXXXX (autocompletar números panameños)
    function formatearTelefono(num) {
        if (!num) return '';
        const digits = num.replace(/\D/g, '');
        // Ya tiene código de país completo (10+ dígitos incluyendo código)
        if (digits.length >= 10) return `+${digits}`;
        // 8 dígitos: número local panameño (6XXXXXXX o 2XXXXXXX etc.)
        if (digits.length === 8) return `+507${digits}`;
        // 7 dígitos: número panameño fijo antiguo
        if (digits.length === 7) return `+507${digits}`;
        // 9 dígitos: posiblemente ya incluye el 507 sin el +
        if (digits.length === 9 && digits.startsWith('507')) return `+${digits}`;
        // Cualquier otro caso, agregar + directo
        return `+${digits}`;
    }

    let contactNum = '';
    try {
        const contactRaw = await msg.getContact();
        if (contactRaw && contactRaw.number) {
            contactNum = contactRaw.number.replace(/\D/g, '');
        }
    } catch(e) {}
    // Fallback: si contact.number no está disponible, usar el sender (puede ser LID)
    if (!contactNum || contactNum.length < 7) {
        contactNum = sender.split('@')[0].replace(/\D/g, '');
    }

    const isFromAdmin = adminIds.includes(sender) || adminIds.includes(contactNum) || adminIds.includes(msg.author || '');

    if (isFromAdmin) {
        // ── Comando: saludar NÚMERO ────────────────────────────────────────────────
        // ── Comando: saludar NÚMERO o saluda NÚMERO ────────────────────────────────────────────────
        const matchSaludo = texto.match(/^saludar?\s*(\+?\d+)/);
        if (matchSaludo) {
            let targetNumber = matchSaludo[1].replace(/\D/g, '');
            if (targetNumber.length > 0) {
                if (targetNumber.length === 8 || targetNumber.length === 7) targetNumber = '507' + targetNumber;
                const targetId = `${targetNumber}@c.us`;
                const saludoMsg = `¡Hola! 👋 Te escribimos de *ElectroTaller* (mensaje automático del bot).\nAquí te compartimos nuestra información de contacto para que puedas guardar nuestro número y realizar tus consultas de forma rápida.\n\n🕒 *Horarios:*\nLunes a Viernes de 8:00 AM - 12:00 PM y 1:00 PM - 6:00 PM\n\n📍 *Ubicación (Waze):*\nhttps://waze.com/ul/hd1x7qcpc7\n\nQuedamos a la orden para apoyarte con tus equipos.`;
                try {
                    await clientInstance.sendMessage(targetId, saludoMsg);
                    return msg.reply(`✅ Saludo enviado exitosamente a ${targetNumber}`);
                } catch (err) {
                    return msg.reply(`❌ Error al enviar saludo a ${targetNumber}: ${err.message}`);
                }
            }
        }

        // ── Comando: tomar NÚMERO — pausa el bot para ese cliente ──────────────────
        if (texto.startsWith('tomar ')) {
            let targetNumber = texto.split(' ')[1]?.replace(/\D/g, '') || '';
            if (targetNumber.length === 8) targetNumber = '507' + targetNumber;
            if (targetNumber.length > 0) {
                const targetId = `${targetNumber}@c.us`;
                humanTakenOver[targetId] = true;
                console.log(`🙋 [ADMIN] Toma de control activada para ${targetId}`);
                return msg.reply(`✅ *Modo humano activado* para el cliente *${targetNumber}*.\nEl bot está en pausa para ese chat. Cuando termines, escribe:\n👉 *liberar ${targetNumber}*`);
            }
            return msg.reply('❌ Formato incorrecto. Usa: *tomar 5071234567*');
        }

        // ── Comando: liberar NÚMERO — reactiva el bot para ese cliente ─────────────
        if (texto.startsWith('liberar ')) {
            let targetNumber = texto.split(' ')[1]?.replace(/\D/g, '') || '';
            if (targetNumber.length === 8) targetNumber = '507' + targetNumber;
            if (targetNumber.length > 0) {
                const targetId = `${targetNumber}@c.us`;
                delete humanTakenOver[targetId];
                console.log(`🤖 [ADMIN] Bot reactivado para ${targetId}`);
                return msg.reply(`✅ *Bot reactivado* para el cliente *${targetNumber}*. ElectroBot volverá a responder automáticamente.`);
            }
            return msg.reply('❌ Formato incorrecto. Usa: *liberar 5071234567*');
        }

        // ── Comando: responder NÚMERO mensaje — envía mensaje al cliente con corrección ortográfica ──
        if (texto.startsWith('responder ')) {
            const partes = msg.body.trim().split(' ');
            if (partes.length >= 3) {
                let targetNumber = partes[1].replace(/\D/g, '');
                if (targetNumber.length === 8 || targetNumber.length === 7) targetNumber = '507' + targetNumber;
                const mensajeOriginal = partes.slice(2).join(' ');
                if (targetNumber.length > 0 && mensajeOriginal.length > 0) {
                    const targetId = `${targetNumber}@c.us`;
                    let mensajeFinal = mensajeOriginal;

                    // Corregir ortografía y gramática con Gemini si está disponible
                    if (genAI) {
                        try {
                            const modelCorrector = genAI.getGenerativeModel({
                                model: geminiModelName,
                                systemInstruction: 'Eres un corrector ortográfico y gramatical de español. Tu única tarea es corregir el texto que te envíen: corrige errores de ortografía, acentos, puntuación y gramática, manteniendo el estilo casual y el tono original del autor. NO agregues saludos, NO cambies el significado, NO expliques nada. Devuelve SOLO el texto corregido.'
                            });
                            const resultCorrecion = await modelCorrector.generateContent(mensajeOriginal);
                            const textoCorregido = resultCorrecion.response.text().trim();
                            if (textoCorregido && textoCorregido.length > 0) {
                                mensajeFinal = textoCorregido;
                                console.log(`[CORRECTOR] Original: "${mensajeOriginal}" → Corregido: "${textoCorregido}"`);
                            }
                        } catch (errCorrector) {
                            console.warn('[CORRECTOR] No se pudo corregir el mensaje, se envía el original:', errCorrector.message);
                        }
                    }

                    try {
                        await clientInstance.sendMessage(targetId, mensajeFinal);
                        const notaCorreccion = mensajeFinal !== mensajeOriginal
                            ? `\n\n_✏️ Texto corregido automáticamente por el bot._`
                            : '';
                        return msg.reply(`✅ Mensaje enviado a *${targetNumber}*:\n"${mensajeFinal}"${notaCorreccion}`);
                    } catch (err) {
                        return msg.reply(`❌ Error al enviar mensaje a ${targetNumber}: ${err.message}`);
                    }
                }
            }
            return msg.reply('❌ Formato incorrecto. Usa: *responder +50761234567 Tu mensaje aquí*');
        }

        // ── Comando: chats — lista los chats bajo control humano ──────────────────
        if (texto === 'chats' || texto === 'activos') {
            const activos = Object.keys(humanTakenOver);
            if (activos.length === 0) {
                return msg.reply('ℹ️ No hay chats bajo control humano en este momento. El bot está respondiendo a todos.');
            }
            const lista = activos.map(id => `• ${id.replace('@c.us', '')}`).join('\n');
            return msg.reply(`🙋 *Chats bajo control humano (bot pausado):*\n${lista}\n\nPara reactivar el bot en uno de ellos escribe: *liberar NÚMERO*`);
        }
    }

    // ── Verificar si el chat está bajo control humano (bot pausado) ────────────────
    if (humanTakenOver[sender]) {
        console.log(`[${nombreLinea}] Chat en modo humano, ignorando mensaje de ${sender}`);
        return; // El técnico humano está atendiendo, el bot no interviene
    }

    // ── Opcional: Si Gemini está activo y configurado, procesar con IA ─────────────────
    if (genAI) {
        try {
            // Obtener el número de teléfono del remitente con formato +507XXXXXXXX
            // contactNum ya fue resuelto correctamente (priorizando contact.number) al inicio del handler
            const senderPhoneNum = formatearTelefono(contactNum);
            console.log(`[IA] Número del remitente resuelto: ${senderPhoneNum}`);

            const textoUpper = texto.toUpperCase();

            // Filtrar y formatear SOLO las órdenes verificadas para inyectarlas en el contexto de la IA
            // Las órdenes sin verificar (sin PIN ni Número de Orden) se OMITEN completamente
            // para evitar que la IA filtre información basándose en nombres de clientes
            const ordersVerificadas = [];
            let ordenesSinVerificar = 0;

            dbOrders.forEach(o => {
                // Construir un solo string con todo el historial de la sesión más el mensaje actual
                const chatCompleto = (chatHistories[sender] || []).map(m => m.parts[0].text).join(' ').toUpperCase() + ' ' + textoUpper;

                // 1. Validar si el cliente proporcionó el PIN/Cédula en el chat
                let pinMatch = false;
                if (o.securityPin) {
                    const dbPin = o.securityPin.toUpperCase().trim();
                    if (dbPin && chatCompleto.includes(dbPin)) {
                        pinMatch = true;
                    }
                }

                // 2. Validar si el cliente proporcionó el Número de Orden en el chat
                let idMatch = false;
                if (o.id) {
                    const idDigits = o.id.replace(/\D/g, '');
                    if (idDigits.length >= 2 && chatCompleto.includes(idDigits)) {
                        idMatch = true;
                    }
                    if (chatCompleto.includes(o.id.toUpperCase())) {
                        idMatch = true;
                    }
                }

                if (pinMatch || idMatch) {
                    // Acceso Total: proporcionó PIN o ID de orden — mostrar datos completos
                    const pinStr = o.securityPin ? o.securityPin : 'No registrado';
                    const descCompleta = obtenerDescripcionEquipo(o);
                    const saldo = (Number(o.budget) || 0) - (Number(o.downPayment) || 0);
                    ordersVerificadas.push(`- ID: ${o.id}, Cliente: ${o.clientName}, PIN: ${pinStr}, Equipo: ${descCompleta}, Estado: ${o.status}, Presupuesto: $${o.budget || 0}, Anticipo: $${o.downPayment || 0}, Saldo Pendiente: $${saldo}`);
                } else {
                    // Sin verificar: NO incluir en el contexto (ni nombre, ni equipo, nada)
                    ordenesSinVerificar++;
                }
            });

            // Construir el contexto final: solo órdenes verificadas + conteo anónimo de las demás
            let ordersContext = '';
            if (ordersVerificadas.length > 0) {
                ordersContext = ordersVerificadas.join('\n');
            }
            if (ordenesSinVerificar > 0) {
                ordersContext += `\n(Hay ${ordenesSinVerificar} orden(es) adicional(es) en el sistema que NO se muestran aquí porque el cliente aún no ha proporcionado su Número de Orden o PIN Rápido. Si el cliente pregunta por su equipo, pídele uno de esos datos.)`;
            }
            if (!ordersContext) {
                ordersContext = 'No hay órdenes verificadas para este cliente.';
            }

            // Leer de forma dinámica el manual de entrenamiento en cada mensaje
            let manualEntrenamiento = "";
            const rutaEntrenamiento = path.join(__dirname, 'instrucciones_ia.txt');
            if (fs.existsSync(rutaEntrenamiento)) {
                try {
                    manualEntrenamiento = fs.readFileSync(rutaEntrenamiento, 'utf-8');
                } catch (errManual) {
                    console.warn('⚠️ No se pudo leer el archivo de entrenamiento:', errManual.message);
                }
            }

            // Obtener fecha y hora actual del sistema local
            const opcionesFecha = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
            const fechaActualStr = new Date().toLocaleString('es-ES', opcionesFecha);

            const systemPrompt = `Eres "ElectroBot", el asistente virtual inteligente de "ElectroTaller", un taller especializado en reparación de equipos electrónicos, refrigeración y automotriz.
Tu objetivo es responder de forma profesional, atenta, empática y muy concisa (máximo 2 o 3 párrafos cortos) a los clientes a través de WhatsApp.

### Información de Tiempo Real del Servidor:
- Fecha y hora actual del sistema: ${fechaActualStr}
- Número de WhatsApp actual del cliente: ${senderPhoneNum}

### Manual de Operaciones y Base de Conocimientos (Entrenamiento):
${manualEntrenamiento || 'Establecer políticas predeterminadas de atención cordial y asistencia en fallas básicas de refrigeración.'}

### Información de Conectividad Humana:
- Opción de hablar con humano (técnico): ${allowHumanContact ? 'Habilitada' : 'Deshabilitada temporalmente'}
  - Si el cliente solicita de manera explícita hablar con un técnico o un humano, responde de forma atenta que en breve un técnico humano del taller tomará el control del chat para atenderle directamente.
- Opción de notificar a administradores fuera de horario: ${notifyAfterHours ? 'Habilitada' : 'Deshabilitada'}

### Base de Datos de Reparaciones (En Tiempo Real):
A continuación se listan las órdenes activas en el taller:
${ordersContext || 'No hay órdenes registradas activas en este momento.'}

### Regla Estricta de Privacidad y Seguridad:
1. NUNCA reveles información de órdenes de trabajo (estado, equipo, presupuesto, saldo) si el cliente solo proporcionó su nombre. El nombre NO es un dato válido de autenticación.
2. Los ÚNICOS datos válidos para consultar una orden son: el Número de Orden (ej. ORDEN-123), la Cédula del cliente, o el PIN Rápido.
3. Si un cliente pregunta por su orden y en la base de datos ves que el Estado dice "[OCULTO POR SEGURIDAD]", significa que debes pedirle credenciales. NO INVENTES EL ESTADO. ESTÁ TOTALMENTE PROHIBIDO. Respóndele amablemente: "Por motivos de seguridad, para proteger tu privacidad necesito que me proporciones tu *Número de Orden* (ej. ORDEN-123), tu *Cédula* o tu *PIN Rápido* para poder brindarte los detalles."
4. Si en tu lista de órdenes SÍ ves el estado normal (ej. "Listo para Entrega"), significa que el cliente ya proporcionó un dato válido y puedes brindarle toda la información sin dudar.
5. Si el cliente te dice su nombre y pregunta por su equipo, NO le confirmes si existe o no una orden a su nombre. Pídele directamente su número de orden, cédula o PIN.

### Instrucciones Críticas de Comportamiento:
1. **Búsqueda e Identificación de Órdenes:**
   - SOLO busca órdenes cuando el cliente proporcione su Número de Orden, Cédula o PIN Rápido. Si el cliente solo dice su nombre, NO busques ni confirmes la existencia de órdenes. Pídele uno de los tres datos válidos.
   - Si encuentras solo UNA orden que coincida y el estado NO está oculto, explícale detalladamente su estado real, incluyendo presupuesto y saldo pendiente.
   - Si encuentras MÚLTIPLES órdenes para la misma búsqueda, NO le des los detalles completos. Muéstrale una breve lista numerada y pregúntale de cuál desea saber el detalle.
   - Si el cliente pregunta por el estado de su equipo sin proporcionar datos de autenticación, pídele que te comparta su *Número de Orden* (ej. ORDEN-123), su *Cédula* o su *PIN Rápido*. NUNCA le pidas su nombre como dato para buscar órdenes.
2. **Estilo de Respuesta:**
   - Sé muy natural, profesional y conciso.
   - Si el mensaje actual del cliente contiene lenguaje ofensivo o insultos directos: debes responder ÚNICAMENTE con la palabra clave: [IGNORAR_MENSAJE].`;

            // Obtener el modelo de Gemini pasando la instrucción de sistema de forma dinámica como lo exige el SDK
            const model = genAI.getGenerativeModel({
                model: geminiModelName,
                systemInstruction: systemPrompt
            });

            // Inicializar historial de conversación si no existe
            if (!chatHistories[sender]) {
                chatHistories[sender] = [];
            }

            // ── Soporte Multimodal: Detectar y procesar notas de voz ───────────────────
            const esAudio = msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt');
            let audioPart = null;
            let textoMensaje = msg.body || "";

            if (esAudio) {
                try {
                    console.log(`🎙️ Recibiendo nota de voz de ${sender}...`);
                    const media = await msg.downloadMedia();
                    if (media && media.data) {
                        audioPart = {
                            inlineData: {
                                data: media.data,
                                mimeType: media.mimetype
                            }
                        };
                        textoMensaje = "[Nota de voz enviada por el cliente]";
                    }
                } catch (errMedia) {
                    console.error('❌ Error al descargar nota de voz:', errMedia.message);
                }
            }

            // Crear el array temporal de contents que enviaremos a Gemini en esta llamada
            const consultaContents = [...chatHistories[sender]];

            if (esAudio && audioPart) {
                consultaContents.push({
                    role: 'user',
                    parts: [
                        { text: "El cliente te envió una nota de voz. Escúchala con mucha atención y respóndele basándote en tu base de conocimientos y en la base de datos de órdenes sincronizadas en tiempo real." },
                        audioPart
                    ]
                });
            } else {
                consultaContents.push({
                    role: 'user',
                    parts: [{ text: textoMensaje }]
                });
            }

            // Llamar a Gemini enviándole la consulta conversacional (e inlineData de audio si aplica)
            const result = await model.generateContent({
                contents: consultaContents,
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 2048,
                }
            });

            let respuestaIA = result.response.text();
            if (respuestaIA && respuestaIA.trim().length > 0) {
                // Interceptar código de moderación de agresividad / lenguaje obsceno
                if (respuestaIA.includes('[IGNORAR_MENSAJE]')) {
                    console.log(`⚠️ Gemini determinó ignorar el mensaje de ${sender} debido a tono agresivo o lenguaje obsceno.`);
                    return; // Salir sin contestar
                }

                // Verificar si hay alguna etiqueta de escalamiento
                const tagsEscalamiento = ['[ESCALAR_AIRE]', '[ESCALAR_AUTO]', '[ESCALAR_GENERAL]'];
                let etiquetaEncontrada = null;
                for (const tag of tagsEscalamiento) {
                    if (respuestaIA.includes(tag)) {
                        etiquetaEncontrada = tag;
                        respuestaIA = respuestaIA.replace(tag, '').trim();
                        break; // Solo tomamos la primera que encuentre
                    }
                }

                // Extraer la etiqueta [TEL:+507XXXXXXXX] con el número del cliente
                let telefonoCliente = senderPhoneNum; // fallback al número resuelto por el sistema
                const telMatch = respuestaIA.match(/\[TEL:(\+?\d{7,15})\]/);
                if (telMatch) {
                    telefonoCliente = telMatch[1];
                    respuestaIA = respuestaIA.replace(telMatch[0], '').trim();
                    console.log(`[ESCALAMIENTO] Número de teléfono del cliente extraído de etiqueta: ${telefonoCliente}`);
                }

                // Responder al cliente
                if (respuestaIA) {
                    await msg.reply(respuestaIA);
                }

                // Si se encontró una etiqueta de escalamiento, notificar a los admins
                if (etiquetaEncontrada) {
                    const adminMsg = `⚠️ *Solicitud de Atención Técnica*\n\n` +
                                     `👤 *Cliente:* ${telefonoCliente}\n` +
                                     `📝 *Pregunta del cliente:* ${textoMensaje}\n` +
                                     `🤖 *Respuesta que dio el bot:* ${respuestaIA || '(Solo transfirió el chat)'}\n\n` +
                                     `🏷️ *Etiqueta:* ${etiquetaEncontrada}\n\n` +
                                     `📋 Comandos rápidos en los siguientes mensajes 👇`;
                    
                    let idsAEnviar = [];
                    if (etiquetaEncontrada === '[ESCALAR_AIRE]' && adminAire.length > 0) {
                        idsAEnviar = adminAire;
                    } else if (etiquetaEncontrada === '[ESCALAR_AUTO]' && adminAuto.length > 0) {
                        idsAEnviar = adminAuto;
                    } else {
                        idsAEnviar = adminIds;
                    }
                    
                    // Si el arreglo asignado está vacío, enviar a los admins generales por defecto
                    if (idsAEnviar.length === 0) {
                        idsAEnviar = adminIds;
                    }

                    for (const id of idsAEnviar) {
                        let formatId = id;
                        if (!formatId.includes('@')) {
                            formatId = `${formatId}@c.us`;
                        }
                        try {
                            await clientInstance.sendMessage(formatId, adminMsg);
                            // Enviar los 3 comandos como mensajes individuales para reenvío fácil
                            await clientInstance.sendMessage(formatId, `tomar ${telefonoCliente}`);
                            await clientInstance.sendMessage(formatId, `responder ${telefonoCliente} `);
                            await clientInstance.sendMessage(formatId, `liberar ${telefonoCliente}`);
                            console.log(`[ESCALAMIENTO] Mensaje enviado a administrador ${formatId}`);
                        } catch (err) {
                            console.error(`[ESCALAMIENTO] Error enviando a administrador ${formatId}:`, err.message);
                        }
                    }
                }

                // Registrar los turnos en formato de texto simplificado en el historial permanente
                chatHistories[sender].push({ role: 'user', parts: [{ text: textoMensaje }] });
                chatHistories[sender].push({ role: 'model', parts: [{ text: respuestaIA || 'Transferido a humano' }] });
                
                // Mantener los últimos 10 mensajes
                if (chatHistories[sender].length > 10) {
                    chatHistories[sender] = chatHistories[sender].slice(-10);
                }
                return; // Ya respondimos al cliente arriba
            }
        } catch (error) {
            console.error('❌ Error en el motor de IA Gemini:', error.message);
            // Si la IA falla por cuota, internet, etc., caemos directamente en el fallback tradicional
        }
    }

    // ── FALLBACK TRADICIONAL: Menú interactivo estructurado (si la IA no está configurada o falló) ──
    if (userStates[sender] && userStates[sender].state === 'WAITING_SELECTION') {
        const selectedIndex = parseInt(texto) - 1;
        if (!isNaN(selectedIndex) && selectedIndex >= 0 && selectedIndex < userStates[sender].orders.length) {
            const orderEncontrada = userStates[sender].orders[selectedIndex];
            delete userStates[sender]; // Limpiar el estado

            const formatearMoneda = (monto) => {
                return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto || 0);
            };
            const saldo = (Number(orderEncontrada.budget) || 0) - (Number(orderEncontrada.downPayment) || 0);
            const equipo = obtenerDescripcionEquipo(orderEncontrada);

            let respuesta = `📄 *Orden:* ${orderEncontrada.id} - ${equipo}\n` +
                            `👤 *Cliente:* ${orderEncontrada.clientName}\n` +
                            `📌 *Estado Actual:* ${orderEncontrada.status}\n`;
                            
            if (saldo > 0) {
                respuesta += `💰 *Saldo Pendiente:* ${formatearMoneda(saldo)}\n`;
            } else if (orderEncontrada.budget > 0) {
                respuesta += `✅ *Esta orden ya está pagada.*\n`;
            }

            return msg.reply(respuesta.trim());
        } else {
            return msg.reply('❌ Opción inválida. Por favor responde únicamente con el número de la lista que deseas consultar (Ej: 1).');
        }
    }

    if (userStates[sender] === 'WAITING_ORDER_ID') {
        // Eliminar el estado para que el próximo mensaje sea normal
        delete userStates[sender];

        const busquedaRaw = msg.body.trim().toLowerCase();
        if (busquedaRaw.length < 3) {
            return msg.reply('Por favor ingresa al menos 3 letras o números para realizar la búsqueda.');
        }

        const orderIdBuscado = normalizarTextoBusqueda(msg.body);
        
        // Buscar la orden en la base de datos sincronizada comparando ID, cliente o equipo
        const ordenesEncontradas = dbOrders.filter(o => {
            const matchId = normalizarTextoBusqueda(o.id) === orderIdBuscado;
            
            // Para búsquedas por nombre, exigimos que escriba nombre y apellido (que haya al menos un espacio en su texto),
            // a menos que escriba exactamente el nombre completo como está en la base de datos.
            const matchName = o.clientName && (
                o.clientName.toLowerCase() === busquedaRaw || 
                (o.clientName.toLowerCase().includes(busquedaRaw) && busquedaRaw.includes(' '))
            );

            const matchDevice = (o.deviceType && o.deviceType.toLowerCase().includes(busquedaRaw)) || 
                                (o.deviceDesc && o.deviceDesc.toLowerCase().includes(busquedaRaw)) ||
                                (o.vehicleData && o.vehicleData.brand && o.vehicleData.brand.toLowerCase().includes(busquedaRaw)) ||
                                (o.vehicleData && o.vehicleData.model && o.vehicleData.model.toLowerCase().includes(busquedaRaw)) ||
                                (o.acData && o.acData.brand && o.acData.brand.toLowerCase().includes(busquedaRaw)) ||
                                (o.acData && o.acData.model && o.acData.model.toLowerCase().includes(busquedaRaw)) ||
                                (o.brand && o.brand.toLowerCase().includes(busquedaRaw)) ||
                                (o.model && o.model.toLowerCase().includes(busquedaRaw));
            return matchId || matchName || matchDevice;
        });

        if (ordenesEncontradas.length > 1) {
            userStates[sender] = { state: 'WAITING_SELECTION', orders: ordenesEncontradas };
            let respuesta = 'Hemos encontrado varios equipos asociados a tu búsqueda. Por favor, responde con el *número* del equipo que deseas consultar:\n\n';
            ordenesEncontradas.forEach((order, index) => {
                const equipo = obtenerDescripcionEquipo(order);
                respuesta += `${index + 1}️⃣ *Orden:* ${order.id} - ${equipo}\n`;
            });
            return msg.reply(respuesta.trim());
        } else if (ordenesEncontradas.length === 1) {
            const orderEncontrada = ordenesEncontradas[0];
            const formatearMoneda = (monto) => {
                return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto || 0);
            };
            const saldo = (Number(orderEncontrada.budget) || 0) - (Number(orderEncontrada.downPayment) || 0);
            const equipo = obtenerDescripcionEquipo(orderEncontrada);

            let respuesta = `📄 *Orden:* ${orderEncontrada.id} - ${equipo}\n` +
                            `👤 *Cliente:* ${orderEncontrada.clientName}\n` +
                            `📌 *Estado Actual:* ${orderEncontrada.status}\n`;
                            
            if (saldo > 0) {
                respuesta += `💰 *Saldo Pendiente:* ${formatearMoneda(saldo)}\n`;
            } else if (orderEncontrada.budget > 0) {
                respuesta += `✅ *Esta orden ya está pagada.*\n`;
            }

            return msg.reply(respuesta.trim());
        } else {
            return msg.reply(`No hemos podido encontrar una orden coincidente con *${msg.body}*. Por favor verifica los datos o intenta buscar por número de orden.`);
        }
    }

    // Detección de saludos (hola, buenas, menu, info)
    const saludos = ['hola', 'buenas', 'buenos', 'menu', 'menú', 'info', 'ayuda'];
    let esSaludo = false;
    for (const saludo of saludos) {
        if (texto.includes(saludo) && texto.length < 20) {
            esSaludo = true;
            break;
        }
    }

    if (esSaludo) {
        let menuMsg = "¡Hola! Bienvenido a nuestro taller. ¿En qué podemos ayudarte?\n\n" +
                      "1️⃣ Consultar estado de reparación\n" +
                      "2️⃣ Horarios y ubicación\n";
        
        if (allowHumanContact) {
            menuMsg += "3️⃣ Hablar con un humano\n";
        }
        
        menuMsg += "\n*(Por favor, responde solo con el número de tu opción)*";
        return msg.reply(menuMsg);
    }

    // Detección de opciones del menú
    if (texto === '1') {
        userStates[sender] = 'WAITING_ORDER_ID'; // Ponemos al usuario en modo de espera
        return msg.reply('Por favor, escribe el *número de tu orden* (Ej: ORDEN-123), tu *nombre y apellido completo* o la *marca/tipo de equipo*. En breve verificaremos su estado.');
    }
    
    if (texto === '2') {
        return msg.reply('🕒 Trabajamos de Lunes a Viernes de 9:00 AM a 6:00 PM y Sábados de 9:00 AM a 2:00 PM.\n📍 Estamos ubicados en [Tu Dirección].');
    }

    if (texto === '3') {
        if (allowHumanContact) {
            return msg.reply('En un momento uno de nuestros técnicos te atenderá personalmente. ¡Gracias por tu paciencia!');
        } else {
            return msg.reply('Opción no válida. Por favor responde con 1 o 2.');
        }
    }
    }); // fin client.on('message')
} // fin registrarListenerMensajes

// Endpoint de la API para recibir los mensajes desde app.js (soporta parámetro opcional "line" 1 o 2)
expressApp.post('/send', async (req, res) => {
    // Validar API Key antes de procesar
    const providedKey = req.headers['x-api-key'] || req.body.apiKey;
    if (providedKey !== API_KEY) {
        console.warn(`🔒 [API] Intento de envío rechazado: API key inválida.`);
        return res.status(401).json({ success: false, error: 'API key inválida o no proporcionada.' });
    }

    const { phone, message, line } = req.body;
    
    // Determinar qué cliente y estado de preparación usar
    const selectedLine = Number(line) === 2 ? 2 : 1;
    const isReady = selectedLine === 1 ? isReady1 : isReady2;
    const targetClient = selectedLine === 1 ? client1 : client2;

    if (!isReady || !targetClient) {
        return res.status(503).json({ success: false, error: `El cliente de WhatsApp para la [LÍNEA ${selectedLine}] aún no está listo. Escanea el código QR primero.` });
    }

    try {
        if (!phone || !message) {
            return res.status(400).json({ success: false, error: 'Se requiere el número de teléfono (phone) y el mensaje (message).' });
        }

        // Formatear el número (remover espacios, símbolos, etc.)
        let formattedPhone = phone.replace(/\D/g, ''); 

        // Si es un número de 10 dígitos (formato estándar de México sin código de país)
        // se lo agregamos automáticamente para que WhatsApp lo reconozca.
        let tryPhones = [];

        if (formattedPhone.length === 10) {
            // En México, WA a veces requiere '521' y otras veces '52' antes del número de 10 dígitos.
            tryPhones.push(`521${formattedPhone}@c.us`);
            tryPhones.push(`52${formattedPhone}@c.us`);
        } else {
            // Para números que ya traen el código o son diferentes
            if (!formattedPhone.endsWith('@c.us')) {
                formattedPhone = `${formattedPhone}@c.us`;
            }
            tryPhones.push(formattedPhone);
        }

        // Buscar el número válido entre las opciones en el cliente de la línea seleccionada
        let validPhone = null;
        for (let p of tryPhones) {
            if (await targetClient.isRegisteredUser(p)) {
                validPhone = p;
                break;
            }
        }

        if (!validPhone) {
            console.log(`❌ [LÍNEA ${selectedLine}] Número no registrado en WA: ${phone}`);
            return res.status(400).json({ success: false, error: 'El número de teléfono no parece estar registrado en WhatsApp.' });
        }

        formattedPhone = validPhone;

        // Enviar el mensaje por el cliente correspondiente
        const response = await targetClient.sendMessage(formattedPhone, message);
        console.log(`📩 [LÍNEA ${selectedLine}] Mensaje enviado correctamente a ${phone}`);
        return res.json({ success: true, response, lineUsed: selectedLine });

    } catch (error) {
        console.error(`❌ [LÍNEA ${selectedLine}] Error enviando mensaje:`, error);
        return res.status(500).json({ success: false, error: error.toString() });
    }
});

// ─────────────────────────────────────────────────────────
// ARRANCAR EL SERVIDOR HTTP Y EL CLIENTE DE WHATSAPP MULTILÍNEA
// ─────────────────────────────────────────────────────────
expressApp.listen(port, () => {
    console.log(`🚀 Servidor API del Bot escuchando en http://localhost:${port}`);
});

// Iniciar ambos clientes de WhatsApp en paralelo con almacenamiento persistente independiente
crearCliente(1);
crearCliente(2);
