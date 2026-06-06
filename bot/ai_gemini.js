const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const utils = require('./utils.js');

let genAI = null;
let geminiModelName = 'gemini-1.5-flash';

module.exports = {
    initGemini() {
        const apiKeyValida = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'tu_api_key_aqui';
        geminiModelName = (process.env.GEMINI_MODEL || 'gemini-1.5-flash').trim().toLowerCase().replace(/\s+/g, '-');

        if (apiKeyValida) {
            try {
                genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                console.log(`🤖 IA de Google Gemini configurada y lista (Modelo: ${geminiModelName}).`);
            } catch (e) {
                console.error('❌ Error al inicializar Gemini:', e.message);
            }
        } else {
            console.warn('⚠️ No se detectó una GEMINI_API_KEY válida en el archivo .env. El bot usará el menú interactivo como fallback.');
        }
        return genAI;
    },

    async corregirGramatica(mensajeOriginal) {
        if (!genAI) return null;
        try {
            const modelCorrector = genAI.getGenerativeModel({
                model: geminiModelName,
                systemInstruction: 'Eres un corrector ortográfico y gramatical de español. Tu única tarea es corregir el texto que te envíen: corrige errores de ortografía, acentos, puntuación y gramática, manteniendo el estilo casual y el tono original del autor. NO agregues saludos, NO cambies el significado, NO expliques nada. Devuelve SOLO el texto corregido.'
            });
            const resultCorrecion = await modelCorrector.generateContent(mensajeOriginal);
            return resultCorrecion.response.text().trim();
        } catch (errCorrector) {
            console.warn('[CORRECTOR] No se pudo corregir el mensaje, se envía el original:', errCorrector.message);
            return null;
        }
    },

    async procesarMensaje(msg, clientInstance, texto, sender, contactNum, dbOrders, chatHistories, allowHumanContact, notifyAfterHours, adminIds, adminAire, adminAuto) {
        if (!genAI) return false; // Returns false if AI not available
        try {
                // Obtener el número de teléfono del remitente con formato +507XXXXXXXX
                // contactNum ya fue resuelto correctamente (priorizando contact.number) al inicio del handler
                const senderPhoneNum = utils.formatearTelefono(contactNum);
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
                        const descCompleta = utils.obtenerDescripcionEquipo(o);
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
                const rutaEntrenamiento = path.join(__dirname, '..', 'instrucciones_ia.txt');
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
            return true;

    }
};
