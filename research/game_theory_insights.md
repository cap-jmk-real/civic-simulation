## TL;DR

Game theory basics (Nash, dominance, zero-sum vs cooperative) pair naturally with simulation toolkits (agent-based models, evolutionary dynamics, Monte Carlo/empirical game methods) to study strategic interaction. Bounded-rational and behavioral extensions (quantal response, anchoring, recursive reasoning, learning) and agent-based simulations are widely used to model non‑rational actors and to compare intellectual‑property regimes, where simulations show open regimes increase diffusion given institutional support while strong IP raises private incentives but can reduce social knowledge production.

----

## Game theory fundamentals and simulation methods

This section summarizes core solution concepts and the principal computational/simulation methods used to analyze complex games and their equilibria. It ties formal definitions to the numerical tools researchers use when closed‑form solutions are infeasible.

- Definitions and equilibrium concepts  
  - **Nash equilibrium** is the standard solution concept where no player can unilaterally improve payoff by deviating from their strategy [1].  
  - **Dominant strategy** denotes an action that is best for a player regardless of others' choices [1].  
  - **Zero‑sum versus cooperative games**: zero‑sum games model strictly opposing payoffs, while cooperative (general‑sum) games allow mutual gains and form the basis for bargaining and coalition analysis [1].

- Simulation and computational methodologies  
  - **Agent‑based modeling (ABM)** builds interacting agents governed by rules to study emergent strategic outcomes when game size or heterogeneity prevents analytical solutions [2] [3].  
  - **Evolutionary game simulations** (replicator dynamics, evolutionary stable strategies) treat strategy frequencies as dynamical variables to study selection-like adaptation and equilibrium selection [1] [4].  
  - **Empirical and Monte Carlo game‑theoretic methods** use repeated sampled game plays, payoff sampling, or tournament simulations to estimate strategy performance and approximate equilibria in large games [2] [3].  
  - **Algorithms for complex/stochastic games** combine game solvers with sampling/approximation to compute (approximate) Nash or saddle‑point solutions in large or imperfect‑information settings [5].

Key references for the above methods include formal expositions of one‑shot and evolutionary solution concepts [1], surveys of evolutionary dynamics [4], empirical game‑analysis and simulation practice [2], and methodological critiques of simulation explanatory power [3].

----

## Encoding non rational actors in models

This section outlines approaches used to relax perfect‑rationality assumptions and to encode observed human or boundedly rational behavior in strategic models and simulations.

- Classes of bounded or behavioral models  
  - **Bounded rationality and recursive reasoning** models formalize limits on agents’ reasoning depth and information processing; generalized recursive reasoning provides a structured way to model varying levels of strategic sophistication [6] [5].  
  - **Anchoring and flattening biases** have been formalized for sequential Stackelberg settings to represent humans’ tendency to underweight extreme probabilities, producing tractable formulations for optimization and heuristics [5].  
  - **Quantal response and temperature‑style models** replace best‑response with stochastic choice rules (smooth response functions) that interpolate between random and utility‑maximizing behavior; such smooth models improve identifiability and learning in inverse problems [7].  
  - **Behavioral game approaches and descriptive agents** incorporate domain‑specific cognitive or institutional rules to produce empirically realistic behaviors in simulation experiments [8].

- Specific representational techniques and learning dynamics  
  - **Reinforcement learning and RL frameworks** embed payoff‑driven incremental adaptation; deep RL has been used to solve complex principal–agent or sequential decision problems with limited attention [9] [10].  
  - **Evolutionary/replicator dynamics** model population learning and selection of strategies over time and serve as both biological metaphors and learning approximations in repeated settings [1] [4].  
  - **Quantal/inexact‑response benefits**: bounded‑rational (quantal) followers smooth optimization landscapes, which can make inverse/estimation tasks easier and stabilize numerical solution methods [7].  
  - **Irrationality models in ABM and probabilistic frameworks** include bistable probability formulations and explicit rule‑based “irrational” agents that deviate systematically from utility maximization; such models change equilibrium counts and welfare outcomes in canonical games [11] [8].

- Gaps in supplied literature  
  - **Prospect theory** is not represented in the supplied corpus; insufficient evidence.  
  - **Fictitious play** (explicit references or implementations) is also not present in the supplied set; insufficient evidence.

Representative methodological citations above show how researchers move from normative equilibria to richer, empirically grounded models of decision making [6] [5] [7] [8] [11] [10] [9].

----

## Information sharing and intellectual property models

This section compares game‑theoretic and simulation approaches to information sharing under proprietary versus open regimes, summarizes key models and simulation findings, and lists central authors.

Opening paragraph: Game‑theoretic models of information sharing frame producers and consumers as strategic players with choices to share, withhold, invest, or enforce rights; evolutionary and agent‑based simulations are frequently used to compare outcomes under strong copyright, limited IP, and open access rules. The table below summarizes how strategic incentives and modeled outcomes differ across typical regimes and cites simulation evidence.

| Regime | Strategic incentives | Typical models used | Key simulation findings |
|---|---:|---|---|
| **Strong copyright** | Higher private returns for exclusive producers; enforcement imposes costs and deterrence incentives | War of attrition, dynamic property‑rights games, institutional game models | Strong IP raises private capture and enforcement conflicts; can reduce local diffusion and access in simulated systems [12] [13] |
| **Limited IP or mixed** | Balance between private incentives and sharing through licensing or regulated disclosure | Evolutionary games, ABM with I‑Space concept, cooperation/retaliation strategies | Mixed regimes can sustain cooperation via institutions or sanctions; obsolescence and diffusibility parameters critically affect aggregate innovation and social cost [14] [15] [16] |
| **Open access / no copyright** | Low private rent but high potential diffusion and downstream reuse | PD framing, social simulations with multiple stakeholders (academics, funders, publishers) | Open regimes increase sharing and downstream transformation when institutional actors (funders/politicians) support mandates; publishers may avoid extreme opposition [17] [18] |

- Notable models and empirical/simulation findings  
  - **Agent‑based I‑Space simulations** by Boisot and colleagues used ABM to vary control of diffusibility and obsolescence and found that property‑regime variation materially affects the quantity and social cost of new knowledge in the simulated economy [14].  
  - **Open data as a Prisoner’s Dilemma**: modeling of researcher sharing framed producer/consumer interactions as PD variants and explored payoff structures across institutional scenarios [17].  
  - **Open access social simulations** by Teran and Dávila modeled multiple stakeholders (academics, publishers, funders, politicians) and found that mandates and policy support are decisive for open‑access outcomes; publishers often face pressures and extreme opposition is suboptimal for them [18].  
  - **Evolutionary analysis of IP cooperation** used replicator‑type evolutionary games to simulate cooperation dynamics under alternative institutional scenarios and showed governance mechanisms (trust, communication, punishment) shift equilibria toward sharing or withholding [15].  
  - **War of attrition applied to IP disputes** highlighted asymmetric enforcement incentives and proposed policy constructs (e.g., Free IP Zones) to change local strategic equilibria [12].  
  - **Institutional and political economy critiques** analyze network effects, production feasibility, and demand elasticities to explain why open strategies face political‑economic obstacles and to propose regulatory designs that better align incentives for broader access [13].

- Key authors and representative works  
  - **Max Boisot et al.** on property rights and information‑space ABM and their effects on knowledge production and social cost [14].  
  - **Bradly Alicea** on PD models of open data sharing [17].  
  - **Oswaldo Teran and Jacinto Dávila** on multi‑actor social simulations of Open Access [18].  
  - **Zaoli Yang, Yuanyuan Shi, Yuchen Li** on evolutionary game analysis of IP cooperation [15].  
  - **Manuel G. Chávez‑Ángeles and Patricia S. Sánchez‑Medina** on war‑of‑attrition models and FIPZ proposals [12].  
  - **David W. Opderbeck** on political‑economy game models comparing open and proprietary IP policy choices [13].

Overall, the supplied simulation literature consistently shows that institutional context (policy mandates, funder and political support, enforcement costs, and knowledge obsolescence) is as important as the presence or absence of formal copyright for determining whether equilibria favor broad sharing or concentrated private capture [14] [17] [18] [15] [12] [13].

## References

[1]C. Kiekintveld, “Empirical Game-Theoretic Methods for Strategy Design and Analysis in Complex Games.,” pp. 1935–1936, Jan. 2008.

[2]H. Gintis, “Game theory evolving: A problem-centered introduction to modeling strategic interaction”, [Online]. Available: https://www.degruyterbrill.com/document/doi/10.1515/9781400830077/html

[3]R. A. Gillman and D. Housman, “Game theory: a modeling approach,” May 2019, [Online]. Available: https://api.taylorfrancis.com/content/books/mono/download?identifierName=doi&identifierValue=10.1201/9781315156880&type=googlepdf

[4]W. Elsner, T. Heinrich, and H. Schwardt, “Tools II: More Formal Concepts of Game Theory and Evolutionary Game Theory,” pp. 193–226, Jan. 2015, doi: 10.1016/B978-0-12-411585-9.00008-7.

[5]S. Ganzfried, “Computing Nash Equilibria in Multiplayer DAG-Structured Stochastic Games with Persistent Imperfect Information,” Oct. 26, 2020. [Online]. Available: https://arxiv.org/abs/2010.13860v2

[6]D. Helbing, “Evolutionary Game Theory,” pp. 247–274, Jan. 2010, doi: 10.1007/978-3-642-11546-2_12.

[7]谷本潤, “Fundamentals of evolutionary game theory and its applications,” Jan. 2015.

[8]S. Lasaulce and H. Tembine, “Game Theory and Learning for Wireless Networks: Fundamentals and Applications,” Oct. 2011.

[9]Y. Wen, Y. Yang, Y. Yang, and J. Wang, “Modelling Bounded Rationality in Multi-Agent Interactions by Generalized Recursive Reasoning,” vol. 1, pp. 414–421, July 2020, doi: 10.24963/IJCAI.2020/58.

[10]P. Weirich, “Computer Simulations in Game Theory,” Jan. 2006.

[11]J. Pi, J. L. Heyman, and A. Gupta, “Two Algorithms for Computing Exact and Approximate Nash Equilibria in Bimatrix Games,” Mar. 31, 2019. [Online]. Available: https://arxiv.org/abs/1904.00450v2

[12]M. M. Asl and M. Sadeghi, “A theoretical framework to explain non-Nash equilibrium strategic   behavior in experimental games,” Jan. 2025, doi: 10.48550/arxiv.2501.11404.

[13]“Solving Dynamic Principal-Agent Problems with a Rationally Inattentive   Principal,” Jan. 2022, doi: 10.48550/arxiv.2202.01691.

[14]D. Bouchaffra, F. Ykhlef, M. Lebbah, and H. Azzag, “A Collective Variational Principle Unifying Bayesian Inference, Game Theory, and Thermodynamics,” Apr. 30, 2026. [Online]. Available: https://arxiv.org/abs/2604.27942v1

[15]A. Sanjab, “Security of cyber-physical systems with human actors: theoretical foundations, game theory, and bounded rationality,” Nov. 2018, [Online]. Available: https://vtechworks.lib.vt.edu/items/de89187c-f750-46c4-b99d-d3c2cf4594d3

[16]M. Boisot, M. Boisot, I. C. MacMillan, K. S. Han, and K. S. Han, “Property rights and information flows: a simulation approach,” Journal of Evolutionary Economics, vol. 17, no. 1, pp. 63–93, Jan. 2007, doi: 10.1007/S00191-006-0031-7.

[17]B. G. Silverman, G. Bharathy, B. D. Nye, and T. E. Smith, “Modeling factions for `effects based operations’, part II: behavioral game theory,” Computational and Mathematical Organization Theory, vol. 14, no. 2, pp. 120–155, June 2008, doi: 10.1007/S10588-008-9023-5.

[18]D. Shahram, F. Lauren, O. Karim Abdul, M. Catarina, and B. Peter, “Bistable Probabilities: A Unified Framework for Studying Rationality and Irrationality in Classical and Quantum Games,” Feb. 2022, doi: 10.48550/arxiv.2004.03474.