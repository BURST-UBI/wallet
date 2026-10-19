try {
  const dark = localStorage.getItem("burst-appearance") === "dark";
  document.body.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
} catch {
  document.body.classList.remove("dark");
  document.documentElement.style.colorScheme = "light";
}
