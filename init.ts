import { getDatabase, closeDatabase } from './src/db/client.ts'; 

const dbPath=  "/Users/ugmurthy/.desiAgent/tenants/02ad6d7b-27d4-415d-a598-b93b683fbc82/agent.db"

console.log("Initialising db at : ",dbPath);

getDatabase(dbPath, dbPath === ':memory:'); 
closeDatabase(); 
console.log('Migration complete:', dbPath);
