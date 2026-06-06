import os
import re

app_path = r'c:\Users\Personal\Desktop\whatsapp-bot\index.js'
with open(app_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

os.makedirs(r'c:\Users\Personal\Desktop\whatsapp-bot\bot', exist_ok=True)

# 1. Extract utils.js
utils_code = """module.exports = {
    normalizarTextoBusqueda: function(txt) {
        if (!txt) return '';
        return txt.toUpperCase()
            .trim()
            .replace(/^(ORDEN DE SERVICIO|ORDEN DE TRABAJO|ORDEN|ORD|NÚMERO|NUMERO|NUM|N°|N_)+/g, '')
            .replace(/^[\s\-_]+|[\s\-_]+$/g, '')
            .replace(/[\s\-_]+/g, '');
    },
    obtenerDescripcionEquipo: function(order) {
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
    },
    formatearTelefono: function(num) {
        if (!num) return '';
        const digits = num.replace(/\D/g, '');
        if (digits.length >= 10) return `+${digits}`;
        if (digits.length === 8) return `+507${digits}`;
        if (digits.length === 7) return `+507${digits}`;
        if (digits.length === 9 && digits.startsWith('507')) return `+${digits}`;
        return `+${digits}`;
    }
};
"""
with open(r'c:\Users\Personal\Desktop\whatsapp-bot\bot\utils.js', 'w', encoding='utf-8') as f: f.write(utils_code)

# 2. Extract ai_gemini.js
gemini_code = """const { GoogleGenerativeAI } = require('@google/generative-ai');
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
"""

for l in lines[547:809]:
    gemini_code += "    " + l

gemini_code += """            return true; // Indica que Gemini procesó el mensaje
        } catch (error) {
            console.error('❌ Error en el motor de IA Gemini:', error.message);
            return false;
        }
    }
};
"""
# Replace formatearTelefono -> utils.formatearTelefono
gemini_code = gemini_code.replace('formatearTelefono(', 'utils.formatearTelefono(')
gemini_code = gemini_code.replace('obtenerDescripcionEquipo(', 'utils.obtenerDescripcionEquipo(')
# Fix __dirname issue for instrucciones_ia.txt
gemini_code = gemini_code.replace("path.join(__dirname, 'instrucciones_ia.txt')", "path.join(__dirname, '..', 'instrucciones_ia.txt')")

with open(r'c:\Users\Personal\Desktop\whatsapp-bot\bot\ai_gemini.js', 'w', encoding='utf-8') as f: f.write(gemini_code)


# 3. Extract commands.js
commands_code = """const aiGemini = require('./ai_gemini.js');

module.exports = {
    async handleAdminCommands(msg, clientInstance, texto, sender, contactNum, humanTakenOver, adminIds, adminAire, adminAuto) {
"""

for l in lines[442:536]:
    commands_code += l

# Remove genAI grammar correction logic since it's now an async function
commands_code = commands_code.replace('''                    // Corregir ortografía y gramática con Gemini si está disponible
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
                    }''', '''                    // Corregir ortografía y gramática con Gemini
                    const textoCorregido = await aiGemini.corregirGramatica(mensajeOriginal);
                    if (textoCorregido && textoCorregido.length > 0) {
                        mensajeFinal = textoCorregido;
                        console.log(`[CORRECTOR] Original: "${mensajeOriginal}" → Corregido: "${textoCorregido}"`);
                    }''')

commands_code += """        return false; // Not handled
    }
};
"""
with open(r'c:\Users\Personal\Desktop\whatsapp-bot\bot\commands.js', 'w', encoding='utf-8') as f: f.write(commands_code)

# 4. Modify index.js
new_index_lines = []
skip = False
for i, l in enumerate(lines):
    if i == 8: # Line 9: // Inicialización...
        new_index_lines.append("const aiGemini = require('./bot/ai_gemini.js');\n")
        new_index_lines.append("const commands = require('./bot/commands.js');\n")
        new_index_lines.append("const utils = require('./bot/utils.js');\n")
        new_index_lines.append("const genAI = aiGemini.initGemini();\n")
        skip = True
    elif i == 37: # End of initialization block
        skip = False
        continue
        
    if 293 <= i <= 331: # Functions normalize and getDesc
        continue
        
    if 410 <= i <= 424: # formatearTelefono
        continue
        
    if i == 439: # if (isFromAdmin)
        new_index_lines.append("    if (isFromAdmin) {\n")
        new_index_lines.append("        const handled = await commands.handleAdminCommands(msg, clientInstance, texto, sender, contactNum, humanTakenOver, adminIds, adminAire, adminAuto);\n")
        new_index_lines.append("        if (handled !== false) return;\n")
        new_index_lines.append("    }\n")
        skip = True
    elif i == 537: # end isFromAdmin
        skip = False
        continue
        
    if i == 545: # if (genAI)
        new_index_lines.append("    // ── Opcional: Si Gemini está activo y configurado, procesar con IA ─────────────────\n")
        new_index_lines.append("    const iaHandled = await aiGemini.procesarMensaje(msg, clientInstance, texto, sender, contactNum, dbOrders, chatHistories, allowHumanContact, notifyAfterHours, adminIds, adminAire, adminAuto);\n")
        new_index_lines.append("    if (iaHandled) return;\n")
        skip = True
    elif i == 810: # end if (genAI)
        skip = False
        continue

    # Update util calls in index.js
    l = l.replace('normalizarTextoBusqueda(', 'utils.normalizarTextoBusqueda(')
    l = l.replace('obtenerDescripcionEquipo(', 'utils.obtenerDescripcionEquipo(')
    l = l.replace('formatearTelefono(', 'utils.formatearTelefono(')
    
    if not skip:
        new_index_lines.append(l)

with open(r'c:\Users\Personal\Desktop\whatsapp-bot\index_updated.js', 'w', encoding='utf-8') as f: f.write(''.join(new_index_lines))
print('Phase 5 done')
