const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const cors = require('cors');

// Solo cargar dotenv en desarrollo
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configuración de Google Sheets
let sheets;
try {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON || '{}'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  sheets = google.sheets({ version: 'v4', auth });
} catch (error) {
  console.error('Error configurando Google Sheets:', error.message);
}

// Configuración de JIRA
const JIRA_API_BASE = process.env.JIRA_BASE_URL || 'https://jira.globaldevtools.bbva.com';

// Función mejorada para hacer solicitudes a JIRA con reintentos
async function jiraApiRequest(endpoint, retries = 3) {
  // Obtener las cookies actuales
  const cookies = process.env.JIRA_COOKIES || '';
  
  if (!cookies || cookies.trim() === '') {
    throw new Error('JIRA_COOKIES no está configurado. Por favor, proporciona las cookies de autenticación.');
  }
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Intento ${attempt} de ${retries} para: ${endpoint}`);
      
      const response = await axios({
        method: 'GET',
        url: `${JIRA_API_BASE}${endpoint}`,
        headers: {
          'Cookie': cookies,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'X-Atlassian-Token': 'no-check',
          'Cache-Control': 'no-cache'
        },
        timeout: 10000, // 10 segundos de timeout
        validateStatus: function (status) {
          return status >= 200 && status < 300;
        }
      });
      
      return response.data;
    } catch (error) {
      console.error(`Error en intento ${attempt}:`, error.message);
      
      if (error.response) {
        console.error('Detalles del error:', {
          status: error.response.status,
          statusText: error.response.statusText,
          headers: error.response.headers
        });
        
        // Si es un error 401, las cookies han expirado
        if (error.response.status === 401) {
          throw new Error('Error de autenticación: Las cookies de JIRA han expirado. Por favor, actualízalas.');
        }
        
        // Si es un error 500 y es el último intento
        if (error.response.status === 500 && attempt === retries) {
          throw new Error('Error del servidor JIRA (500). Posibles causas: permisos insuficientes, issue no existe, o problema temporal del servidor.');
        }
      }
      
      // Si no es el último intento, esperar antes de reintentar
      if (attempt < retries) {
        const waitTime = Math.pow(2, attempt - 1) * 1000; // Backoff exponencial
        console.log(`Esperando ${waitTime}ms antes de reintentar...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        // Si es el último intento, lanzar el error
        throw error;
      }
    }
  }
}

// Función para formatear fechas
function formatDate(inputDate) {
  if (!inputDate) return 'No disponible';
  
  try {
    const date = new Date(inputDate);
    const options = { 
      day: '2-digit', 
      month: 'short', 
      year: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    };
    return date.toLocaleDateString('es-ES', options);
  } catch (error) {
    return inputDate;
  }
}

// Función para obtener la primera fecha de transición
function getFirstTransitionDate(changelog, targetStatus) {
  if (!changelog || !changelog.histories) return 'No disponible';
  
  for (const history of changelog.histories) {
    for (const item of history.items) {
      if (item.field === 'status' && item.toString === targetStatus) {
        return formatDate(history.created);
      }
    }
  }
  
  return 'No disponible';
}

// Función para obtener detalles de una feature
async function getFeatureDetails(featureKey) {
  try {
    const featureData = await jiraApiRequest(`/rest/api/2/issue/${featureKey}?expand=changelog&fields=summary,status,customfield_10272,created,updated`);
    
    const featureTitle = featureData.fields.summary || 'Título no disponible';
    const featureStatus = featureData.fields.status?.name || 'Estado no disponible';
    const sprintEstimate = featureData.fields.customfield_10272?.value || 'No asignado';
    
    const analysingDate = getFirstTransitionDate(featureData.changelog, 'Analysing');
    const progressDate = getFirstTransitionDate(featureData.changelog, 'In Progress');
    const deployedDate = getFirstTransitionDate(featureData.changelog, 'Deployed');
    
    return {
      key: featureKey,
      title: featureTitle,
      status: featureStatus,
      sprintEstimate: sprintEstimate,
      analysingDate: analysingDate,
      progressDate: progressDate,
      deployedDate: deployedDate
    };
  } catch (error) {
    console.error(`Error obteniendo detalles de ${featureKey}:`, error.message);
    return null;
  }
}

// Función para crear o actualizar el Google Sheet
async function updateGoogleSheet(e2eId, features) {
  try {
    if (!sheets) {
      throw new Error('Google Sheets no está configurado');
    }
    
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      throw new Error('GOOGLE_SHEET_ID no está configurado');
    }
    
    const range = 'Sheet1!A1';
    
    // Preparar los datos
    const headers = ['Feature', 'Titulo', 'Estado', 'Sprint Estimado', 'Fecha Analysing', 'Fecha In Progress', 'Fecha Deployed'];
    const rows = [headers];
    
    for (const feature of features) {
      rows.push([
        feature.key,
        feature.title,
        feature.status,
        feature.sprintEstimate,
        feature.analysingDate,
        feature.progressDate,
        feature.deployedDate
      ]);
    }
    
    // Limpiar la hoja y escribir los nuevos datos
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: 'Sheet1!A:Z'
    });
    
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      resource: {
        values: rows
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Error actualizando Google Sheet:', error.message);
    throw error;
  }
}

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    jiraCookiesConfigured: !!(process.env.JIRA_COOKIES && process.env.JIRA_COOKIES.trim() !== ''),
    googleSheetsConfigured: !!sheets
  });
});

// Endpoint para validar la configuración
app.get('/api/config-status', (req, res) => {
  const status = {
    jira: {
      baseUrl: JIRA_API_BASE,
      cookiesConfigured: !!(process.env.JIRA_COOKIES && process.env.JIRA_COOKIES.trim() !== ''),
      cookiesLength: process.env.JIRA_COOKIES ? process.env.JIRA_COOKIES.length : 0
    },
    googleSheets: {
      configured: !!sheets,
      sheetId: process.env.GOOGLE_SHEET_ID ? 'Configurado' : 'No configurado'
    }
  };
  
  res.json(status);
});

// Endpoint para procesar E2E
app.post('/api/process-e2e', async (req, res) => {
  const { e2eId, jiraCookies } = req.body;
  
  if (!e2eId) {
    return res.status(400).json({ error: 'E2E ID es requerido' });
  }
  
  // Limpiar el E2E ID
  const cleanE2eId = e2eId.trim();
  
  // Validar formato del E2E ID - Actualizado para aceptar letras y números
  if (!cleanE2eId.match(/^[A-Z0-9]+-\d+$/)) {
    return res.status(400).json({ 
      error: 'Formato de E2E ID inválido',
      message: 'El formato debe ser PROJECT-NUMBER (ej: E2E-295970)'
    });
  }
  
  // Actualizar cookies si se proporcionaron
  if (jiraCookies && jiraCookies.trim() !== '') {
    process.env.JIRA_COOKIES = jiraCookies;
    console.log('Cookies de JIRA actualizadas');
  }
  
  // Verificar que hay cookies configuradas
  if (!process.env.JIRA_COOKIES || process.env.JIRA_COOKIES.trim() === '') {
    return res.status(401).json({ 
      error: 'Autenticación requerida',
      message: 'No hay cookies de JIRA configuradas. Por favor, proporciona las cookies de autenticación.'
    });
  }
  
  try {
    console.log(`Procesando E2E: ${cleanE2eId}`);
    
    // Obtener información del E2E
    const e2eData = await jiraApiRequest(`/rest/api/2/issue/${cleanE2eId}?fields=issuelinks`);
    
    // Extraer features vinculadas
    const features = [];
    const processedKeys = new Set();
    
    if (e2eData.fields.issuelinks) {
      for (const link of e2eData.fields.issuelinks) {
        let featureKey = null;
        
        if (link.inwardIssue && !link.inwardIssue.key.startsWith('E2E-')) {
          featureKey = link.inwardIssue.key;
        } else if (link.outwardIssue && !link.outwardIssue.key.startsWith('E2E-')) {
          featureKey = link.outwardIssue.key;
        }
        
        if (featureKey && !processedKeys.has(featureKey)) {
          processedKeys.add(featureKey);
          console.log(`Procesando feature: ${featureKey}`);
          
          const featureDetails = await getFeatureDetails(featureKey);
          if (featureDetails) {
            features.push(featureDetails);
          }
        }
      }
    }
    
    if (features.length === 0) {
      return res.status(404).json({ error: 'No se encontraron features vinculadas' });
    }
    
    // Actualizar Google Sheet
    await updateGoogleSheet(cleanE2eId, features);
    
    res.json({
      message: 'Procesamiento completado',
      e2eId: cleanE2eId,
      featuresCount: features.length,
      googleSheetUrl: `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}`
    });
    
  } catch (error) {
    console.error('Error:', error);
    
    // Devolver errores más específicos
    if (error.message.includes('autenticación')) {
      res.status(401).json({ error: 'Error de autenticación', details: error.message });
    } else if (error.message.includes('500')) {
      res.status(502).json({ error: 'Error del servidor JIRA', details: error.message });
    } else {
      res.status(500).json({ error: 'Error procesando la solicitud', details: error.message });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
  console.log('Variables de entorno configuradas:');
  console.log('- GOOGLE_CREDENTIALS_JSON:', process.env.GOOGLE_CREDENTIALS_JSON ? 'Sí' : 'No');
  console.log('- GOOGLE_SHEET_ID:', process.env.GOOGLE_SHEET_ID ? 'Sí' : 'No');
  console.log('- JIRA_COOKIES:', process.env.JIRA_COOKIES ? 'Sí (longitud: ' + process.env.JIRA_COOKIES.length + ')' : 'No');
  console.log('- JIRA_BASE_URL:', JIRA_API_BASE);
});
