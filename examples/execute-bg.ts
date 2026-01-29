/**
 * Example: Create and Execute a DAG
 *
 * This example demonstrates how to:
 * 1. Initialize the desiAgent client
 * 2. Create a DAG from goal text
 * 3. Execute the created DAG
 * 4. Monitor execution status
 *
 * Run with: bun run examples/execute-dag.ts
 */

import { setupDesiAgent } from '../src/index.js';

async function main() {
  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'google/gemini-2.5-flash-lite-preview-09-2025',
    logLevel: 'info',
    databasePath: process.env.DATABASE_PATH
  });

  try {
    console.log('Creating DAG from goal...\n');
    const goal = `
    ### Task Description for Autonomous Agent: Optimizing Entry and Operations in the Quick Commerce Sector

**Objective:** As an autonomous agent, your mission is to solve the business problem of identifying viable entry strategies and operational optimizations for a new startup aiming to launch in the quick commerce industry. Quick commerce (q-commerce) refers to ultra-fast delivery services (typically under 30 minutes) for everyday essentials like groceries, pharmaceuticals, and small consumer goods, leveraging dark stores, micro-fulfillment centers, and advanced logistics tech. The problem to solve: In a saturated market with high competition and slim margins (e.g., players like Instacart, DoorDash, Getir, and emerging AI-driven platforms), how can a new entrant achieve sustainable profitability while scaling rapidly? You will conduct comprehensive research, generate insights, and produce a final report with actionable recommendations. Execute this task in a sequential, methodical manner, using available tools (e.g., web_search, browse_page, x_keyword_search) to gather data. Ensure all steps are logged for transparency.

**High-Level Guidelines for Execution:**
- Prioritize data from 2023-2026 sources to account for post-pandemic shifts, AI integrations, and economic changes.
- Use multiple tools in parallel where efficient (e.g., simultaneous searches).
- Validate information across diverse sources to mitigate bias.
- If data is conflicting, note it and seek corroboration.
- Compile all findings into a structured report at the end, using tables for comparisons.
- Aim for objectivity; substantiate claims with evidence.
- If a step requires external data, use tools before proceeding.
- Total steps: 50 (exceeding the minimum of 25 for comprehensiveness).

**Detailed Steps:**

1. **Initialize Task:** Review the objective and confirm understanding of quick commerce as a sector focused on hyper-local, on-demand delivery with sub-30-minute fulfillment.

2. **Define Scope:** Narrow the focus to key markets (e.g., US, Europe, India, Southeast Asia) based on growth potential; exclude unrelated e-commerce like standard online retail.

3. **Gather Background Knowledge:** Use web_search with query "overview of quick commerce industry 2023-2026" to fetch initial market definitions, evolution from e-commerce, and key differentiators (e.g., vs. traditional delivery).

4. **Identify Core Problem Elements:** Break down the business problem into sub-components: market entry barriers, operational inefficiencies, customer acquisition costs, and profitability challenges.

5. **Brainstorm Research Categories:** Categorize research into areas like market analysis, competitive landscape, consumer behavior, technology, operations, regulations, finances, sustainability, and future trends.

6. **Generate Research Questions - Market Analysis:** Create questions such as: What is the global market size of quick commerce in 2026? What are projected growth rates through 2030? Which regions show the highest CAGR?

7. **Generate Research Questions - Competitive Landscape:** Add questions like: Who are the top 10 quick commerce players globally? What are their market shares? What mergers/acquisitions occurred in 2024-2026?

8. **Generate Research Questions - Consumer Behavior:** Include: What demographics primarily use q-commerce? What are average order values and frequencies? How has consumer preference shifted post-2023 economic downturns?

9. **Generate Research Questions - Technology:** Formulate: What AI/ML technologies are used for route optimization? How do dark stores integrate IoT? What role does blockchain play in supply chain transparency?

10. **Generate Research Questions - Operations:** Ask: What are typical fulfillment times and error rates? How do companies manage inventory in micro-warehouses? What logistics models (e.g., gig workers vs. in-house) are most efficient?

11. **Generate Research Questions - Regulations:** Inquire: What labor laws affect gig economy workers in q-commerce? How do data privacy regulations (e.g., GDPR, CCPA) impact operations? What zoning restrictions apply to dark stores?

12. **Generate Research Questions - Finances:** Pose: What are average profit margins in q-commerce? How do delivery fees and subsidies affect profitability? What funding trends (VC investments) were seen in 2025?

13. **Generate Research Questions - Sustainability:** Include: How do q-commerce firms address carbon emissions from deliveries? What packaging innovations reduce waste? What are ESG reporting requirements?

14. **Generate Research Questions - Challenges:** Add: What are the biggest operational bottlenecks (e.g., last-mile delivery)? How has inflation impacted costs? What cybersecurity risks are prevalent?

15. **Generate Research Questions - Opportunities:** Formulate: Where are underserved markets (e.g., rural areas)? How can partnerships with retailers boost growth? What emerging tech (e.g., drones) offers advantages?

16. **Generate Research Questions - Case Studies:** Ask: What lessons from Getir's 2024 expansion failures? How did Blinkit achieve profitability in India? What innovations did Gorillas introduce in Europe?

17. **Generate Research Questions - Supply Chain:** Inquire: How do q-commerce platforms source goods from suppliers? What just-in-time inventory strategies are used? How resilient are supply chains to disruptions like 2025 global shortages?

18. **Generate Research Questions - Marketing:** Include: What digital marketing tactics yield highest ROI? How effective are loyalty programs? What role do social media influencers play?

19. **Generate Research Questions - Human Resources:** Pose: What training programs exist for pickers/riders? How do companies handle high turnover rates? What diversity initiatives are in place?

20. **Generate Research Questions - Innovation:** Add: How is AR/VR used in virtual shopping? What predictive analytics tools forecast demand? How do autonomous vehicles integrate?

21. **Generate Research Questions - Global Variations:** Formulate: How does q-commerce differ in urban vs. suburban areas? What cultural factors influence adoption in Asia vs. Americas? What currency fluctuations affect international ops?

22. **Generate Research Questions - Risk Management:** Ask: What insurance models cover delivery accidents? How to mitigate fraud in payments? What contingency plans for pandemics?

23. **Generate Research Questions - Metrics and KPIs:** Inquire: What are standard KPIs (e.g., CAC, LTV, AOV)? How to benchmark against competitors? What tools measure customer satisfaction?

24. **Generate Research Questions - Partnerships:** Include: How do integrations with apps like Uber Eats work? What benefits from supermarket collaborations? What API ecosystems enable seamless ops?

25. **Generate Research Questions - Future Trends:** Pose: What impact will Web3 have on q-commerce? How might climate change regulations evolve? What role for metaverse shopping?

26. **Generate Research Questions - Customer Service:** Add: How are chatbots/AI used for support? What resolution times for complaints? How to personalize experiences?

27. **Generate Research Questions - Pricing Strategies:** Formulate: What dynamic pricing models are effective? How do competitors handle surge pricing? What discounts drive retention?

28. **Generate Research Questions - Data Analytics:** Ask: What big data tools analyze user patterns? How to comply with analytics privacy? What A/B testing best practices?

29. **Generate Research Questions - Scalability:** Inquire: How to scale from 1 city to 10? What infrastructure investments needed? How to maintain quality during growth?

30. **Generate Research Questions - Exit Strategies:** Include: What IPO trends in q-commerce? How do acquisitions value companies? What pivot options if model fails?

31. **Compile All Research Questions:** Aggregate the generated questions (aim for 100+ total across categories) into a master list, ensuring no duplicates and comprehensive coverage.

32. **Prioritize Questions:** Rank questions by relevance to the core problem (entry strategies and optimizations), grouping into must-answer (core) and nice-to-have (supplementary).

33. **Plan Data Collection:** For each question, map appropriate tools (e.g., web_search for market stats, x_keyword_search for real-time sentiments on X).

34. **Execute Batch Searches - Market/Competitive:** Use web_search and browse_page in parallel for top-priority questions in market analysis and competitive landscape.

35. **Execute Batch Searches - Consumer/Tech:** Parallel tool calls for consumer behavior and technology questions, incorporating x_semantic_search for user opinions.

36. **Execute Batch Searches - Ops/Regs:** Gather data on operations and regulations using site-specific searches (e.g., site:gov for laws).

37. **Execute Batch Searches - Finances/Sustainability:** Search for financial reports and ESG data, validating with multiple sources.

38. **Execute Batch Searches - Challenges/Opps:** Use x_keyword_search with filters like "quick commerce challenges 2026" for latest discussions.

39. **Execute Batch Searches - Case Studies/Supply Chain:** Browse specific company pages (e.g., Getir's investor reports) and search for case studies.

40. **Execute Batch Searches - Remaining Categories:** Cover all other questions in batches, ensuring coverage of at least 50 questions.

41. **Analyze Data:** For each answered question, summarize key findings, note sources, and identify patterns or gaps.

42. **Cross-Validate Findings:** Compare data across categories (e.g., how tech impacts ops) and resolve inconsistencies.

43. **Synthesize Insights:** Combine answers to form thematic sections: e.g., "Entry Barriers" from market and competitive data.

44. **Identify Opportunities:** Based on challenges, propose 5-10 specific strategies (e.g., AI-optimized routing to cut costs by 20%).

45. **Model Scenarios:** Provide  basic financial models (e.g., breakeven analysis for a new entrant).

46. **Draft Report Structure:** Outline the report with sections mirroring research categories, including executive summary, findings, recommendations.

47. **Populate Report:** Insert synthesized answers, using tables for comparisons (e.g., competitor matrix).

48. **Add Growth Data:** If applicable provide data on growth 

49. **Review and Refine:** Check for completeness, bias, and actionability; iterate on any weak sections.

50. **Finalize and Output Report:** Compile the comprehensive report where combined answers to research questions provide a full q-commerce overview, with recommendations solving the entry/optimization problem. End with next steps for implementation.

51. Write the Finalised report to qc-operations.md 
52. email the report to ugmurthy@gmail.com
 
    `
    const createResult = await client.dags.createFromGoal({
      goalText: goal,
      agentName: 'DecomposerV8',
      temperature: 0.7,
    });

    if (createResult.status !== 'success' || !('dagId' in createResult)) {
      console.log('DAG creation did not return a dagId:', createResult.status);
      if (createResult.status === 'clarification_required') {
        console.log('Clarification needed:', createResult.clarificationQuery);
      }
      return;
    }

    const dagId = createResult.dagId;
    console.log('DAG created with ID:', dagId);

    // Execute the DAG
    console.log('\nExecuting DAG...');
    const execution = await client.dags.execute(dagId);

    
    console.log('Execution started!');
    console.log('  Execution ID:', execution.id);
    console.log('  Status:', execution.status);
    
    
    // Wait for execution to complete
    for await (const event of client.executions.streamEvents(execution.id)) {
      console.log('Event:', event.type, event.data);
    }

    // Get execution details with substeps
    const executionDetails = await client.executions.getWithSubSteps(execution.id);
    console.log('\nExecution Details:');
    console.log('  Status:', executionDetails.status);
    console.log('  SubSteps count:', executionDetails.subSteps?.length ?? 0);

    if (executionDetails.subSteps && executionDetails.subSteps.length > 0) {
      console.log('\nSubSteps:');
      for (const step of executionDetails.subSteps) {
        console.log(`  - Task ${step.taskId}: ${step.status}`);
      }
    }


  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.shutdown();
  }
}

main();
