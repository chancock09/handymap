import "./docs.css";
const payload = {
  latitude: 37.7749,
  longitude: -122.4194,
  title: "Hello from San Francisco",
  message: "We just shipped our first project.",
};
const endpoint = `${location.origin}/api/pings`;
const localEndpoint = "http://localhost:8787/api/pings";
document.getElementById("curl-example")!.textContent =
  `curl '${localEndpoint}' \\\n  --header 'Content-Type: application/json' \\\n  --data '${JSON.stringify(payload, null, 2)}'`;
document.getElementById("js-example")!.textContent =
  `const response = await fetch('${endpoint}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${JSON.stringify(payload, null, 2).replaceAll("\n", "\n  ")})
});

const result = await response.json();
if (!response.ok) {
  throw new Error(result.error.message);
}
console.log(result);`;
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-copy]",
)) {
  button.addEventListener("click", async () => {
    const status = document.getElementById("copy-status")!;
    try {
      await navigator.clipboard.writeText(
        document.getElementById(button.dataset.copy!)!.textContent!,
      );
      status.textContent = "Copied. Run the example to send a ping.";
    } catch {
      status.textContent = "Select the example and copy it with your keyboard.";
    }
  });
}
