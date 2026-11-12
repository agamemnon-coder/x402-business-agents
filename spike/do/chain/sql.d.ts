// wrangler bundles a .sql file as a Text module (its default rule): the import is the file's text.
declare module "*.sql" {
  const text: string;
  export default text;
}
