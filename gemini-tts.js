import { GoogleGenerativeAI } from '@google/generative-ai';
import { EdgeTTS } from 'node-edge-tts';
import 'dotenv/config';

const SYSTEM_INSTRUCTION = 'Bạn là trợ lý ảo bằng giọng nói tiếng Việt. Hãy trả lời câu hỏi bằng văn nói thuần Việt tự nhiên, ngắn gọn, súc tích và dễ nghe. Tuyệt đối không dùng Markdown, không in đậm, không gạch đầu dòng, không đánh số thứ tự, không dùng emoji hay ký tự đặc biệt. Hãy chuyển đổi toàn bộ số, ngày tháng, phần trăm và ký hiệu thành chữ viết rõ ràng (ví dụ: năm 2026 thành năm hai nghìn không trăm hai mươi sáu, % thành phần trăm). Ngắt nghỉ câu bằng dấu chấm, dấu phẩy hợp lý để giọng đọc tự nhiên.';

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY.trim()) : null;

export async function askGemini(prompt, forTTS = true) {
  if (!genAI) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY.');
  }

  const candidateModels = ['gemini-3.5-flash-lite', 'gemini-3-flash-preview'];
  let lastError = null;

  for (const m of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({
        model: m,
        ...(forTTS ? { systemInstruction: SYSTEM_INSTRUCTION } : {}),
      });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      lastError = err;
      console.error(`Gemini model ${m} error:`, err.message);
    }
  }

  throw lastError || new Error('Không thể kết nối đến Google Gemini.');
}

export function cleanText(text) {
  return (text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_#~>]/g, '')
    .replace(/[-•]\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function generateSpeechBuffer(text, voice = 'vi-VN-HoaiMyNeural') {
  const sanitizedText = cleanText(text);
  if (!sanitizedText) {
    throw new Error('Văn bản trống, không thể tạo âm thanh.');
  }

  const voiceCandidates = [voice, 'vi-VN-NamMinhNeural'];

  for (const v of voiceCandidates) {
    try {
      const tts = new EdgeTTS({
        voice: v,
        lang: 'vi-VN',
        outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        timeout: 15000,
      });

      const chunks = [];
      for await (const chunk of tts.streamAudio(sanitizedText)) {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        }
      }

      if (!chunks.length) {
        throw new Error(`Không nhận được dữ liệu âm thanh từ Edge TTS (${v}).`);
      }

      return Buffer.concat(chunks);
    } catch (err) {
      console.error(`Lỗi khi tạo giọng đọc Edge-TTS với voice ${v}:`, err.message);
      if (v === voiceCandidates[voiceCandidates.length - 1]) {
        throw err;
      }
    }
  }
}

export async function askGeminiAndSpeak(prompt) {
  try {
    const rawText = await askGemini(prompt, true);
    const text = cleanText(rawText);
    const audioBuffer = await generateSpeechBuffer(text);
    return { text, audioBuffer };
  } catch (err) {
    console.error('Lỗi trong pipeline askGeminiAndSpeak:', err.message);
    throw err;
  }
}
