const aiGemini = require('./ai_gemini.js');
const utils = require('./utils.js');
const { MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    async handleHostCommands(msg, clientInstance, texto, sender, humanTakenOver, nombreLinea) {
        if (texto === '/pausar' || texto === '/tomar') {
            humanTakenOver[sender] = true;
            console.log(`🙋 [HOST] Toma de control activada para ${sender}`);
            return true;
        }

        if (texto === '/activar' || texto === '/liberar') {
            delete humanTakenOver[sender];
            console.log(`🤖 [HOST] Bot reactivado para ${sender}`);
            return true;
        }

        if (texto === '/ubicacion') {
            const msj = `📍 *Nuestra Ubicación*\nCalle 95B, Casa L-20, Panama.\n\n🚗 *Llega fácilmente con Waze:*\nhttps://waze.com/ul/hd1x7qcpc7`;
            await clientInstance.sendMessage(sender, msj);
            return true;
        }

        if (texto === '/horario') {
            const msj = `🕒 *Nuestro Horario de Atención:*\n🗓️ Lunes a Viernes:\n⏱️ Mañana: 08:00 AM – 12:00 PM\n⏱️ Tarde: 01:00 PM – 06:00 PM\n🛑 Sábados y Domingos: Cerrado`;
            await clientInstance.sendMessage(sender, msj);
            return true;
        }

        if (texto === '/garantia') {
            const msj = `🛡️ *Tiempos de Cobertura (Garantía):*\n• 1 Mes: Reparaciones electrónicas de aire acondicionado y refrigeración.\n• 3 Meses: Módulos automotrices y tableros (clusters).\n\n⚙️ *Condiciones Generales:*\nAplica exclusivamente sobre las refacciones instaladas y la mano de obra. (Los reemplazos de componentes IPM no cuentan con garantía por depender del estado de la red eléctrica y del compresor).`;
            await clientInstance.sendMessage(sender, msj);
            return true;
        }

        if (texto === '/requisitos') {
            const msj = `📋 *Requisitos para Revisión:*\n\n❄️ *Aire Acondicionado:* Por favor traer ambas tarjetas (condensadora y evaporadora), junto con el display y sus sensores.\n🚗 *Automotriz (ECU/Módulos):* Únicamente el módulo afectado.\n⚠️ *Para Error P0:* Traer solamente la tarjeta de la unidad condensadora exterior.`;
            await clientInstance.sendMessage(sender, msj);
            return true;
        }

        if (texto === '/yappy' || texto === '/pago') {
            let msj = '';
            let nombreImagen = '';

            if (nombreLinea === 'Línea 1') {
                // Configuración para Línea 1 (Erick)
                msj = `📲 *Pagos por Yappy*\nEnvíe su pago al número: *66219681* (Erick Chuello).\n\nPor favor, envíenos el comprobante por este medio una vez realizado el pago.`;
                nombreImagen = 'yappy_linea1.jpg';
            } else {
                // Configuración para Línea 2 (Yuli)
                msj = `📲 *Pagos por Yappy*\nEnvíe su pago al número: *66231561* (Yulibeth Barrios).\n\nPor favor, envíenos el comprobante por este medio una vez realizado el pago.`;
                nombreImagen = 'yappy_linea2.jpg';
            }
            
            // Buscar la imagen en la carpeta media
            const rutaImagen = path.join(__dirname, '..', 'media', nombreImagen);
            
            if (fs.existsSync(rutaImagen)) {
                // Si la imagen existe, la enviamos con el texto como leyenda (caption)
                const media = MessageMedia.fromFilePath(rutaImagen);
                await clientInstance.sendMessage(sender, media, { caption: msj });
            } else {
                // Si la imagen no existe aún, enviamos solo el texto
                await clientInstance.sendMessage(sender, msj + `\n\n_(Nota para el Admin: Guarda tu código QR como '${nombreImagen}' dentro de la carpeta 'media' del bot para que se envíe automáticamente)._`);
            }
            return true;
        }

        if (texto === '/estado') {
            const msj = humanTakenOver[sender] 
                ? `⚠️ *INFO:* El bot está *PAUSADO* en este chat. Escribe /activar para reanudarlo.` 
                : `🤖 *INFO:* El bot está *ACTIVO* en este chat. Escribe /pausar para detener sus respuestas automáticas.`;
            await clientInstance.sendMessage(sender, msj);
            return true;
        }

        return false; // Comando no reconocido
    },

    async handleAdminCommands(msg, clientInstance, texto, sender, contactNum, humanTakenOver, adminIds, adminAire, adminAuto) {
        
        // ── Comando: saludar NÚMERO ───────────────────────────────────────────
        if (texto.startsWith('saludar ') || texto.startsWith('saluda ')) {
            const rawNumber = texto.replace(/^saludar?\s*/i, '');
            const targetNumberFormatted = utils.formatearTelefono(rawNumber).replace('+', '');
            
            if (targetNumberFormatted.length > 5) {
                const targetId = `${targetNumberFormatted}@c.us`;
                const saludoMsg = `¡Hola! 👋 Te escribimos de *ElectroTaller* (mensaje automático del bot).\nAquí te compartimos nuestra información de contacto para que puedas guardar nuestro número y realizar tus consultas de forma rápida.\n\n🕒 *Horarios:*\nLunes a Viernes de 8:00 AM - 12:00 PM y 1:00 PM - 6:00 PM\n\n📍 *Ubicación (Waze):*\nhttps://waze.com/ul/hd1x7qcpc7\n\nQuedamos a la orden para apoyarte con tus equipos.`;
                try {
                    await clientInstance.sendMessage(targetId, saludoMsg);
                    return msg.reply(`✅ Saludo enviado exitosamente a ${targetNumberFormatted}`);
                } catch (err) {
                    return msg.reply(`❌ Error al enviar saludo a ${targetNumberFormatted}: ${err.message}`);
                }
            }
            return msg.reply('❌ Formato incorrecto. Usa: *saludar 1234-5678*');
        }

        // ── Comando: tomar NÚMERO ─────────────────────────────────────────────
        if (texto.startsWith('tomar ')) {
            const rawNumber = texto.replace(/^tomar\s*/i, '');
            const targetNumberFormatted = utils.formatearTelefono(rawNumber).replace('+', '');
            if (targetNumberFormatted.length > 5) {
                const targetId = `${targetNumberFormatted}@c.us`;
                humanTakenOver[targetId] = true;
                console.log(`🙋 [ADMIN] Toma de control activada para ${targetId}`);
                return msg.reply(`✅ *Modo humano activado* para el cliente *${targetNumberFormatted}*.\nEl bot está en pausa para ese chat. Cuando termines, escribe:\n👉 *liberar ${targetNumberFormatted}*`);
            }
            return msg.reply('❌ Formato incorrecto. Usa: *tomar 5071234567*');
        }

        // ── Comando: liberar NÚMERO ───────────────────────────────────────────
        if (texto.startsWith('liberar ')) {
            const rawNumber = texto.replace(/^liberar\s*/i, '');
            const targetNumberFormatted = utils.formatearTelefono(rawNumber).replace('+', '');
            if (targetNumberFormatted.length > 5) {
                const targetId = `${targetNumberFormatted}@c.us`;
                delete humanTakenOver[targetId];
                console.log(`🤖 [ADMIN] Bot reactivado para ${targetId}`);
                return msg.reply(`✅ *Bot reactivado* para el cliente *${targetNumberFormatted}*. ElectroBot volverá a responder automáticamente.`);
            }
            return msg.reply('❌ Formato incorrecto. Usa: *liberar 5071234567*');
        }

        // ── Comando: responder NÚMERO mensaje ─────────────────────────────────
        if (texto.startsWith('responder ')) {
            // Ejemplo: responder +507 1234-5678 Hola cómo estás
            // Con Regex capturamos primero el bloque de números y símbolos y luego el texto
            const matchResponder = texto.match(/^responder\s*([\+\d\s\-]+)(.+)/i);
            if (matchResponder) {
                const targetNumberFormatted = utils.formatearTelefono(matchResponder[1]).replace('+', '');
                const mensajeOriginal = matchResponder[2].trim();
                
                if (targetNumberFormatted.length > 5 && mensajeOriginal.length > 0) {
                    const targetId = `${targetNumberFormatted}@c.us`;
                    let mensajeFinal = mensajeOriginal;

                    // Corregir ortografía y gramática con Gemini
                    const textoCorregido = await aiGemini.corregirGramatica(mensajeOriginal);
                    if (textoCorregido && textoCorregido.length > 0) {
                        mensajeFinal = textoCorregido;
                        console.log(`[CORRECTOR] Original: "${mensajeOriginal}" → Corregido: "${textoCorregido}"`);
                    }

                    try {
                        await clientInstance.sendMessage(targetId, mensajeFinal);
                        const notaCorreccion = mensajeFinal !== mensajeOriginal
                            ? `\n\n_✏️ Texto corregido automáticamente por el bot._`
                            : '';
                        return msg.reply(`✅ Mensaje enviado a *${targetNumberFormatted}*:\n"${mensajeFinal}"${notaCorreccion}`);
                    } catch (err) {
                        return msg.reply(`❌ Error al enviar mensaje a ${targetNumberFormatted}: ${err.message}`);
                    }
                }
            }
            return msg.reply('❌ Formato incorrecto. Usa: *responder +50761234567 Tu mensaje aquí*');
        }

        // ── Comando: chats ────────────────────────────────────────────────────
        if (texto === 'chats' || texto === 'activos') {
            const activos = Object.keys(humanTakenOver);
            if (activos.length === 0) {
                return msg.reply('ℹ️ No hay chats bajo control humano en este momento. El bot está respondiendo a todos.');
            }
            const lista = activos.map(id => `• ${id.replace('@c.us', '')}`).join('\n');
            return msg.reply(`🙋 *Chats bajo control humano (bot pausado):*\n${lista}\n\nPara reactivar el bot en uno de ellos escribe: *liberar NÚMERO*`);
        }
        
        return false; // Not handled
    }
};
