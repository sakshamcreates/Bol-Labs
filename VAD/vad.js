export function createVAD({ onSpeechStart, onSpeechEnd }) {
  let audioContext;
  let processor;
  let source;
  let speaking = false;
  let lastSpeechTime = 0;

  async function start(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    source = audioContext.createMediaStreamSource(stream);

    processor = audioContext.createScriptProcessor(2048, 1, 1);

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      let energy = 0;

      for (let i = 0; i < input.length; i++) {
        energy += input[i] * input[i];
      }
      energy /= input.length;

      const now = performance.now();

      if (energy > 0.015) {
        lastSpeechTime = now;
        if (!speaking) {
          speaking = true;
          onSpeechStart();
        }
      } else if (speaking && now - lastSpeechTime > 500) {
        speaking = false;
        onSpeechEnd();
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
  }

  return { start };
}
