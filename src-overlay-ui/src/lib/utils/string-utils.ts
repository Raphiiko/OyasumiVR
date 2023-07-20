export function camelCaseToUpperSnakeCase(str: string) {
	return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).toUpperCase();
}
